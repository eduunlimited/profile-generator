use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const LICENSE_STORE_FILE: &str = "license.json";
const OFFLINE_GRACE_SECS: u64 = 48 * 60 * 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredLicense {
    license_key: String,
    session_token: String,
    machine_id: String,
    last_validated_at: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivateRequest {
    license_key: String,
    machine_id: String,
    app_version: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HeartbeatRequest {
    session_token: String,
    machine_id: String,
    app_version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LicenseApiResponse {
    ok: bool,
    status: Option<String>,
    message: Option<String>,
    session_token: Option<String>,
    license_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    pub licensed: bool,
    pub status: String,
    pub message: String,
    pub license_key: Option<String>,
    pub offline: bool,
}

fn license_api_url() -> Result<String, String> {
    option_env!("LICENSE_API_URL")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            "LICENSE_API_URL was not configured at build time. Set it when building release binaries."
                .to_string()
        })
}

fn licensing_enabled() -> bool {
    if cfg!(debug_assertions) {
        return std::env::var("EPGS_REQUIRE_LICENSE")
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
    }
    true
}

fn license_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| error.to_string())
        .map(|dir| dir.join(LICENSE_STORE_FILE))
}

fn read_stored_license(app: &AppHandle) -> Result<Option<StoredLicense>, String> {
    let path = license_store_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| error.to_string()).map(Some)
}

fn write_stored_license(app: &AppHandle, license: &StoredLicense) -> Result<(), String> {
    let path = license_store_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let raw = serde_json::to_string_pretty(license).map_err(|error| error.to_string())?;
    fs::write(path, raw).map_err(|error| error.to_string())
}

fn clear_stored_license(app: &AppHandle) -> Result<(), String> {
    let path = license_store_path(app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_secs()
}

pub fn machine_id() -> String {
    #[cfg(windows)]
    {
        use std::process::Command;
        let output = Command::new("reg")
            .args(["query", r"HKLM\SOFTWARE\Microsoft\Cryptography", "/v", "MachineGuid"])
            .output();
        if let Ok(result) = output {
            let text = String::from_utf8_lossy(&result.stdout);
            if let Some(line) = text.lines().find(|line| line.contains("MachineGuid")) {
                if let Some(guid) = line.split_whitespace().last() {
                    return hash_machine_component(guid);
                }
            }
        }
    }

    hash_machine_component(
        &whoami::fallible::hostname().unwrap_or_else(|_| "unknown-host".to_string()),
    )
}

fn hash_machine_component(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"profile-generator-license-v1:");
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

async fn post_json<T: Serialize>(url: &str, payload: &T) -> Result<LicenseApiResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;

    let response = client
        .post(url)
        .json(payload)
        .send()
        .await
        .map_err(|error| format!("License server unreachable: {error}"))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(if body.trim().is_empty() {
            "License server rejected the request.".to_string()
        } else {
            body
        });
    }

    response
        .json::<LicenseApiResponse>()
        .await
        .map_err(|error| format!("Invalid license server response: {error}"))
}

fn status_from_api(parsed: &LicenseApiResponse, fallback: &str) -> LicenseStatus {
    let status = parsed.status.clone().unwrap_or_else(|| fallback.to_string());
    LicenseStatus {
        licensed: parsed.ok,
        status,
        message: parsed
            .message
            .clone()
            .unwrap_or_else(|| fallback.to_string()),
        license_key: parsed.license_key.clone(),
        offline: false,
    }
}

pub async fn activate_license(app: &AppHandle, license_key: String) -> Result<LicenseStatus, String> {
    if !licensing_enabled() {
        return Ok(LicenseStatus {
            licensed: true,
            status: "dev".to_string(),
            message: "Licensing disabled in development.".to_string(),
            license_key: None,
            offline: false,
        });
    }

    let license_key = license_key.trim().to_string();
    if license_key.is_empty() {
        return Err("Enter a license key.".to_string());
    }

    let base = license_api_url()?;
    let machine_id = machine_id();
    let payload = ActivateRequest {
        license_key: license_key.clone(),
        machine_id: machine_id.clone(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    };

    let parsed = post_json(&format!("{base}/activate"), &payload).await?;
    if !parsed.ok {
        return Ok(status_from_api(&parsed, "invalid"));
    }

    let session_token = parsed
        .session_token
        .ok_or_else(|| "License server did not return a session token.".to_string())?;

    let stored = StoredLicense {
        license_key: parsed.license_key.unwrap_or(license_key),
        session_token,
        machine_id,
        last_validated_at: now_secs(),
    };
    write_stored_license(app, &stored)?;

    Ok(LicenseStatus {
        licensed: true,
        status: "active".to_string(),
        message: parsed
            .message
            .unwrap_or_else(|| "License activated.".to_string()),
        license_key: Some(stored.license_key),
        offline: false,
    })
}

pub async fn check_license(app: &AppHandle) -> Result<LicenseStatus, String> {
    if !licensing_enabled() {
        return Ok(LicenseStatus {
            licensed: true,
            status: "dev".to_string(),
            message: "Licensing disabled in development.".to_string(),
            license_key: None,
            offline: false,
        });
    }

    let Some(stored) = read_stored_license(app)? else {
        return Ok(LicenseStatus {
            licensed: false,
            status: "missing".to_string(),
            message: "Enter your license key to activate Profile Generator.".to_string(),
            license_key: None,
            offline: false,
        });
    };

    let base = match license_api_url() {
        Ok(url) => url,
        Err(error) => {
            let age = now_secs().saturating_sub(stored.last_validated_at);
            if age <= OFFLINE_GRACE_SECS {
                return Ok(LicenseStatus {
                    licensed: true,
                    status: "offline".to_string(),
                    message: format!("Offline mode ({error})."),
                    license_key: Some(stored.license_key),
                    offline: true,
                });
            }
            return Err(error);
        }
    };

    let payload = HeartbeatRequest {
        session_token: stored.session_token.clone(),
        machine_id: stored.machine_id.clone(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    };

    match post_json(&format!("{base}/heartbeat"), &payload).await {
        Ok(parsed) if parsed.ok => {
            let updated = StoredLicense {
                last_validated_at: now_secs(),
                ..stored
            };
            write_stored_license(app, &updated)?;
            Ok(LicenseStatus {
                licensed: true,
                status: parsed.status.unwrap_or_else(|| "active".to_string()),
                message: parsed
                    .message
                    .unwrap_or_else(|| "License valid.".to_string()),
                license_key: Some(updated.license_key),
                offline: false,
            })
        }
        Ok(parsed) => {
            let _ = clear_stored_license(app);
            Ok(status_from_api(&parsed, "invalid"))
        }
        Err(error) => {
            let age = now_secs().saturating_sub(stored.last_validated_at);
            if age <= OFFLINE_GRACE_SECS {
                Ok(LicenseStatus {
                    licensed: true,
                    status: "offline".to_string(),
                    message: format!("Offline mode ({error})."),
                    license_key: Some(stored.license_key),
                    offline: true,
                })
            } else {
                Err(error)
            }
        }
    }
}

pub async fn clear_license(app: &AppHandle) -> Result<(), String> {
    if licensing_enabled() {
        if let (Some(stored), Ok(base)) = (read_stored_license(app)?, license_api_url()) {
            let payload = HeartbeatRequest {
                session_token: stored.session_token,
                machine_id: stored.machine_id,
                app_version: env!("CARGO_PKG_VERSION").to_string(),
            };
            let _ = post_json(&format!("{base}/deactivate"), &payload).await;
        }
    }
    clear_stored_license(app)
}

pub fn licensing_required() -> bool {
    licensing_enabled()
}
