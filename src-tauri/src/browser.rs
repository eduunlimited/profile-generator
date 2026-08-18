use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSessionLaunchRequest {
    pub account_id: String,
    pub account_label: String,
    pub start_url: Option<String>,
    pub proxy_server: Option<String>,
    pub timezone: Option<String>,
    pub locale: Option<String>,
    pub python_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PythonLaunchPayload {
    account_id: String,
    session_dir: String,
    proxy_server: Option<String>,
    start_url: Option<String>,
    timezone: Option<String>,
    locale: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PythonLaunchResponse {
    ok: bool,
    started: Option<bool>,
    error: Option<String>,
    session_id: Option<String>,
    account_id: Option<String>,
    browser_executable: Option<String>,
    session_data_dir: Option<String>,
    fingerprint_path: Option<String>,
    proxy_label: Option<String>,
    fingerprint_summary: Option<String>,
    start_url: Option<String>,
    cookies_persisted: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSessionLaunchResult {
    pub session_id: String,
    pub account_id: String,
    pub browser_executable: String,
    pub session_data_dir: String,
    pub fingerprint_path: String,
    pub proxy_label: Option<String>,
    pub fingerprint_summary: String,
    pub start_url: Option<String>,
    pub cookies_persisted: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CamoufoxCheckResult {
    pub ready: bool,
    pub message: String,
    pub version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionRunningMarker {
    account_id: String,
    pid: u32,
}

#[derive(Clone, Default)]
pub struct BrowserSessionRegistry(Arc<Mutex<HashMap<String, u32>>>);

impl BrowserSessionRegistry {
    pub fn register(&self, account_id: String, pid: u32) {
        self.0.lock().unwrap().insert(account_id, pid);
    }

    pub fn unregister(&self, account_id: &str) {
        self.0.lock().unwrap().remove(account_id);
    }

    fn registered_ids(&self) -> Vec<String> {
        self.0.lock().unwrap().keys().cloned().collect()
    }
}

fn is_pid_running(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(windows)]
    {
        let output = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output();
        output
            .map(|result| {
                let text = String::from_utf8_lossy(&result.stdout);
                text.contains(&pid.to_string())
            })
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        Path::new(&format!("/proc/{pid}")).exists()
    }
}

fn running_ids_from_markers(app: &AppHandle) -> HashSet<String> {
    let mut ids = HashSet::new();
    let Ok(base) = app.path().app_data_dir().map(|dir| dir.join("browser-sessions")) else {
        return ids;
    };
    if !base.is_dir() {
        return ids;
    }

    let Ok(entries) = fs::read_dir(base) else {
        return ids;
    };

    for entry in entries.flatten() {
        let marker_path = entry.path().join("session-running.json");
        let Ok(raw) = fs::read_to_string(&marker_path) else {
            continue;
        };
        let Ok(marker) = serde_json::from_str::<SessionRunningMarker>(&raw) else {
            let _ = fs::remove_file(&marker_path);
            continue;
        };
        if is_pid_running(marker.pid) {
            ids.insert(marker.account_id);
        } else {
            let _ = fs::remove_file(marker_path);
        }
    }

    ids
}

pub fn list_running_browser_sessions(
    app: &AppHandle,
    registry: &BrowserSessionRegistry,
) -> Vec<String> {
    let mut ids: HashSet<String> = registry.registered_ids().into_iter().collect();
    ids.extend(running_ids_from_markers(app));
    let mut sorted: Vec<String> = ids.into_iter().collect();
    sorted.sort();
    sorted
}

fn watch_browser_session(
    app: AppHandle,
    registry: BrowserSessionRegistry,
    account_id: String,
    mut child: std::process::Child,
) {
    thread::spawn(move || {
        let _ = child.wait();
        registry.unregister(&account_id);
        let _ = app.emit("browser-session-ended", account_id);
    });
}

fn sanitize_session_segment(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn session_dir(app: &AppHandle, account_id: &str, account_label: &str) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| error.to_string())
        .map(|dir| {
            dir.join("browser-sessions").join(format!(
                "{}_{}",
                sanitize_session_segment(account_id),
                sanitize_session_segment(account_label)
            ))
        })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledRuntimeInfo {
    pub available: bool,
    pub python_path: Option<String>,
    pub launcher_script_path: Option<String>,
}

fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn bundled_resource_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().resource_dir().ok()
}

fn dev_launcher_script_path() -> PathBuf {
    project_root()
        .join("scripts")
        .join("camoufox")
        .join("launch_session.py")
}

fn dev_check_script_path() -> PathBuf {
    project_root()
        .join("scripts")
        .join("camoufox")
        .join("check_camoufox.py")
}

fn bundled_launcher_script_path(resource_dir: &Path) -> PathBuf {
    resource_dir.join("camoufox").join("launch_session.py")
}

fn bundled_check_script_path(resource_dir: &Path) -> PathBuf {
    resource_dir.join("camoufox").join("check_camoufox.py")
}

fn bundled_python_path(resource_dir: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        resource_dir.join("python").join("python.exe")
    }
    #[cfg(not(windows))]
    {
        resource_dir.join("python").join("bin").join("python3")
    }
}

fn launcher_script_path(app: &AppHandle) -> PathBuf {
    if let Some(resource_dir) = bundled_resource_dir(app) {
        let bundled = bundled_launcher_script_path(&resource_dir);
        if bundled.exists() {
            return bundled;
        }
    }
    dev_launcher_script_path()
}

fn check_script_path(app: &AppHandle) -> PathBuf {
    if let Some(resource_dir) = bundled_resource_dir(app) {
        let bundled = bundled_check_script_path(&resource_dir);
        if bundled.exists() {
            return bundled;
        }
    }
    dev_check_script_path()
}

fn resolve_python_executable(app: &AppHandle, requested: Option<&str>) -> PathBuf {
    if let Some(path) = requested.map(str::trim).filter(|value| !value.is_empty()) {
        return PathBuf::from(path);
    }

    if let Some(resource_dir) = bundled_resource_dir(app) {
        let bundled = bundled_python_path(&resource_dir);
        if bundled.exists() {
            return bundled;
        }
    }

    let root = project_root();
    let candidates = [
        root.join(".venv").join("Scripts").join("python.exe"),
        root.join(".venv").join("bin").join("python"),
        PathBuf::from("python3"),
        PathBuf::from("python"),
    ];

    for candidate in candidates {
        if candidate.exists() {
            return candidate;
        }
    }

    PathBuf::from("python")
}

fn python_env(app: &AppHandle, python: &Path) -> HashMap<String, String> {
    let mut env: HashMap<String, String> = std::env::vars().collect();
    let Some(resource_dir) = bundled_resource_dir(app) else {
        return env;
    };

    let bundled_python = bundled_python_path(&resource_dir);
    if !bundled_python.exists() || python != bundled_python {
        return env;
    }

    let python_dir = resource_dir.join("python");

    #[cfg(windows)]
    {
        env.insert(
            "PYTHONHOME".to_string(),
            python_dir.display().to_string(),
        );
        env.insert(
            "PYTHONPATH".to_string(),
            python_dir.join("Lib").join("site-packages").display().to_string(),
        );
    }
    #[cfg(not(windows))]
    {
        env.insert(
            "PYTHONHOME".to_string(),
            python_dir.display().to_string(),
        );
        let site_packages = python_dir.join("lib").join("site-packages");
        if site_packages.exists() {
            env.insert("PYTHONPATH".to_string(), site_packages.display().to_string());
        }
    }

    let camoufox_cache = python_dir.join("camoufox-cache");
    if camoufox_cache.exists() {
        env.insert(
            "PLAYWRIGHT_BROWSERS_PATH".to_string(),
            camoufox_cache.display().to_string(),
        );
        env.insert(
            "CAMOUFOX_CACHE_DIR".to_string(),
            camoufox_cache.display().to_string(),
        );
    }

    env
}

pub fn bundled_runtime_info(app: &AppHandle) -> BundledRuntimeInfo {
    let python = resolve_python_executable(app, None);
    let script = launcher_script_path(app);
    let bundled = bundled_resource_dir(app)
        .map(|dir| bundled_python_path(&dir).exists() && bundled_launcher_script_path(&dir).exists())
        .unwrap_or(false);

    BundledRuntimeInfo {
        available: bundled,
        python_path: if python.exists() {
            Some(python.display().to_string())
        } else {
            None
        },
        launcher_script_path: if script.exists() {
            Some(script.display().to_string())
        } else {
            None
        },
    }
}

fn mask_proxy_label(proxy_server: &str) -> String {
    proxy_server
        .split('@')
        .next_back()
        .unwrap_or(proxy_server)
        .split("://")
        .nth(1)
        .unwrap_or(proxy_server)
        .to_string()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyTestResult {
    pub ok: bool,
    pub message: String,
}

fn friendly_proxy_error(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        return "Proxy connection timed out.".to_string();
    }
    if error.is_connect() {
        return format!("Could not connect through proxy: {error}");
    }
    error.to_string()
}

async fn test_proxy_async(proxy_server: &str) -> Result<ProxyTestResult, String> {
    let proxy = reqwest::Proxy::all(proxy_server)
        .map_err(|error| format!("Invalid proxy URL: {error}"))?;

    let client = reqwest::Client::builder()
        .proxy(proxy)
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(6))
        .build()
        .map_err(|error| format!("Could not build HTTP client: {error}"))?;

    let response = client
        .get("https://api.ipify.org?format=json")
        .send()
        .await
        .map_err(|error| friendly_proxy_error(&error))?;

    if !response.status().is_success() {
        return Ok(ProxyTestResult {
            ok: false,
            message: format!("Proxy returned HTTP {}.", response.status()),
        });
    }

    Ok(ProxyTestResult {
        ok: true,
        message: "Proxy connection successful.".to_string(),
    })
}

pub async fn test_proxy(proxy_server: String) -> Result<ProxyTestResult, String> {
    let proxy_server = proxy_server.trim();
    if proxy_server.is_empty() {
        return Ok(ProxyTestResult {
            ok: false,
            message: "No proxy configured.".to_string(),
        });
    }

    test_proxy_async(proxy_server).await
}

pub fn check_camoufox(
    app: &AppHandle,
    python_path: Option<String>,
) -> Result<CamoufoxCheckResult, String> {
    let python = resolve_python_executable(app, python_path.as_deref());
    let script = check_script_path(app);
    if !script.exists() {
        return Err(format!(
            "Camoufox check script not found at {}",
            script.display()
        ));
    }

    let output = Command::new(&python)
        .arg(&script)
        .envs(python_env(app, &python))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("Failed to run Python ({}): {error}", python.display()))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    if let Ok(parsed) = serde_json::from_str::<CamoufoxCheckResult>(&stdout) {
        return Ok(parsed);
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    Ok(CamoufoxCheckResult {
        ready: false,
        message: if stderr.trim().is_empty() {
            format!(
                "Camoufox check failed. Install with: pip install -r requirements-camoufox.txt && python -m camoufox fetch. Output: {}",
                stdout.trim()
            )
        } else {
            stderr.trim().to_string()
        },
        version: None,
    })
}

fn read_launcher_line(
    stdout: std::process::ChildStdout,
    timeout: Duration,
) -> Result<String, String> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let result = reader.read_line(&mut line).map(|_| line);
        let _ = tx.send(result);
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(line)) if line.trim().is_empty() => Err("Camoufox launcher returned no output.".to_string()),
        Ok(Ok(line)) => Ok(line),
        Ok(Err(error)) => Err(format!("Failed to read Camoufox launcher output: {error}")),
        Err(mpsc::RecvTimeoutError::Timeout) => Err(
            "Timed out waiting for Camoufox to open. Check Python/Camoufox setup and proxy.".to_string(),
        ),
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("Camoufox launcher exited before reporting status.".to_string())
        }
    }
}

fn launch_result_from_response(
    parsed: PythonLaunchResponse,
    request: &BrowserSessionLaunchRequest,
    session_dir: &Path,
) -> Result<BrowserSessionLaunchResult, String> {
    if !parsed.ok {
        return Err(parsed
            .error
            .unwrap_or_else(|| "Camoufox launch failed.".to_string()));
    }

    Ok(BrowserSessionLaunchResult {
        session_id: parsed
            .session_id
            .unwrap_or_else(|| request.account_id.clone()),
        account_id: parsed
            .account_id
            .unwrap_or_else(|| request.account_id.clone()),
        browser_executable: parsed
            .browser_executable
            .unwrap_or_else(|| "camoufox".to_string()),
        session_data_dir: parsed
            .session_data_dir
            .unwrap_or_else(|| session_dir.display().to_string()),
        fingerprint_path: parsed
            .fingerprint_path
            .unwrap_or_else(|| session_dir.join("fingerprint.json").display().to_string()),
        proxy_label: parsed.proxy_label.or_else(|| {
            request
                .proxy_server
                .as_ref()
                .map(|value| mask_proxy_label(value))
        }),
        fingerprint_summary: parsed
            .fingerprint_summary
            .unwrap_or_else(|| "Camoufox session".to_string()),
        start_url: parsed.start_url.clone().or(request.start_url.clone()),
        cookies_persisted: parsed.cookies_persisted.unwrap_or(false),
    })
}

pub fn launch_browser_session(
    app: &AppHandle,
    registry: &BrowserSessionRegistry,
    request: BrowserSessionLaunchRequest,
) -> Result<BrowserSessionLaunchResult, String> {
    let session_dir = session_dir(app, &request.account_id, &request.account_label)?;
    fs::create_dir_all(&session_dir).map_err(|error| error.to_string())?;

    let python = resolve_python_executable(app, request.python_path.as_deref());
    let script = launcher_script_path(app);
    if !script.exists() {
        return Err(format!(
            "Camoufox launcher not found at {}. Ensure scripts/camoufox is present.",
            script.display()
        ));
    }

    let payload = PythonLaunchPayload {
        account_id: request.account_id.clone(),
        session_dir: session_dir.display().to_string(),
        proxy_server: request.proxy_server.clone(),
        start_url: request.start_url.clone(),
        timezone: request.timezone.clone(),
        locale: request.locale.clone().or(Some("en-US".to_string())),
    };

    let payload_json =
        serde_json::to_string(&payload).map_err(|error| format!("Invalid launch payload: {error}"))?;

    let mut child = Command::new(&python)
        .arg(&script)
        .arg("--request")
        .arg(&payload_json)
        .envs(python_env(app, &python))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            format!(
                "Failed to start Camoufox launcher with {}: {error}. Install Camoufox: pip install -r requirements-camoufox.txt && python -m camoufox fetch",
                python.display()
            )
        })?;

    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut buffer = Vec::new();
            let _ = Read::read_to_end(&mut reader, &mut buffer);
        });
    }

    let stdout = child
        .stdout
        .take()
        .ok_or("Camoufox launcher did not expose stdout.")?;
    let line = read_launcher_line(stdout, Duration::from_secs(45))?;

    if let Ok(parsed) = serde_json::from_str::<PythonLaunchResponse>(line.trim()) {
        if !parsed.ok {
            let _ = child.kill();
            return launch_result_from_response(parsed, &request, &session_dir);
        }
        if parsed.started.unwrap_or(false) {
            registry.register(request.account_id.clone(), child.id());
            watch_browser_session(
                app.clone(),
                registry.clone(),
                request.account_id.clone(),
                child,
            );
            return launch_result_from_response(parsed, &request, &session_dir);
        }
        let _ = child.kill();
        return launch_result_from_response(parsed, &request, &session_dir);
    }

    let _ = child.kill();
    Err(format!(
        "Camoufox launcher returned invalid JSON: {}",
        line.trim()
    ))
}
