use crate::db;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, State};
use std::sync::Mutex;

pub struct DbState(pub Mutex<Option<Connection>>);

fn with_connection<T>(
    state: &State<DbState>,
    callback: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let guard = state
        .0
        .lock()
        .map_err(|_| "Database lock poisoned".to_string())?;
    let connection = guard.as_ref().ok_or("Database not initialized")?;
    callback(connection)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    pub id: String,
    pub name: String,
    pub email: String,
    pub city: String,
    pub state: String,
    pub jig_preset_name: Option<String>,
    pub created_at: String,
}

fn profile_summary_from_value(value: &Value) -> Option<ProfileSummary> {
    Some(ProfileSummary {
        id: value.get("id")?.as_str()?.to_string(),
        name: value
            .pointer("/name/full")
            .and_then(|item| item.as_str())
            .unwrap_or("")
            .to_string(),
        email: value
            .pointer("/logins/0/email")
            .and_then(|item| item.as_str())
            .unwrap_or("")
            .to_string(),
        city: value
            .pointer("/address/city")
            .and_then(|item| item.as_str())
            .unwrap_or("")
            .to_string(),
        state: value
            .pointer("/address/state")
            .and_then(|item| item.as_str())
            .unwrap_or("")
            .to_string(),
        jig_preset_name: value
            .get("jigPresetName")
            .and_then(|item| item.as_str())
            .map(str::to_string),
        created_at: value
            .get("createdAt")
            .and_then(|item| item.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

#[tauri::command]
pub fn list_profiles(state: State<DbState>) -> Result<Vec<ProfileSummary>, String> {
    with_connection(&state, |connection| {
        let rows = db::list_json(connection, "profiles")?;
        Ok(rows
            .iter()
            .filter_map(|row| serde_json::from_str::<Value>(row).ok())
            .filter_map(|value| profile_summary_from_value(&value))
            .collect())
    })
}

#[tauri::command]
pub fn get_profile(state: State<DbState>, id: String) -> Result<Value, String> {
    with_connection(&state, |connection| {
        let data: String = connection
            .query_row(
                "SELECT data FROM profiles WHERE id = ?1",
                rusqlite::params![id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        serde_json::from_str(&data).map_err(|error| error.to_string())
    })
}

#[tauri::command]
pub fn save_profile(state: State<DbState>, profile: Value) -> Result<(), String> {
    with_connection(&state, |connection| {
        let id = profile
            .get("id")
            .and_then(|item| item.as_str())
            .ok_or("Profile id is required")?
            .to_string();
        let data = serde_json::to_string(&profile).map_err(|error| error.to_string())?;
        db::upsert_json(connection, "profiles", &id, &data, None)
    })
}

#[tauri::command]
pub fn save_profiles(state: State<DbState>, profiles: Vec<Value>) -> Result<(), String> {
    with_connection(&state, |connection| {
        for profile in profiles {
            let id = profile
                .get("id")
                .and_then(|item| item.as_str())
                .ok_or("Profile id is required")?
                .to_string();
            let data = serde_json::to_string(&profile).map_err(|error| error.to_string())?;
            db::upsert_json(connection, "profiles", &id, &data, None)?;
        }
        Ok(())
    })
}

#[tauri::command]
pub fn delete_profile(state: State<DbState>, id: String) -> Result<(), String> {
    with_connection(&state, |connection| db::delete_row(connection, "profiles", &id))
}

#[tauri::command]
pub fn replace_profiles(state: State<DbState>, profiles: Vec<Value>) -> Result<(), String> {
    with_connection(&state, |connection| {
        connection
            .execute("DELETE FROM profiles", [])
            .map_err(|error| error.to_string())?;
        for profile in profiles {
            let id = profile
                .get("id")
                .and_then(|item| item.as_str())
                .ok_or("Profile id is required")?
                .to_string();
            let data = serde_json::to_string(&profile).map_err(|error| error.to_string())?;
            db::upsert_json(connection, "profiles", &id, &data, None)?;
        }
        Ok(())
    })
}

#[tauri::command]
pub fn list_jig_presets(state: State<DbState>) -> Result<Vec<Value>, String> {
    with_connection(&state, |connection| {
        let rows = db::list_json(connection, "jig_presets")?;
        rows.iter()
            .map(|row| serde_json::from_str(row).map_err(|error| error.to_string()))
            .collect()
    })
}

#[tauri::command]
pub fn save_jig_preset(state: State<DbState>, preset: Value) -> Result<(), String> {
    with_connection(&state, |connection| {
        let id = preset
            .get("id")
            .and_then(|item| item.as_str())
            .ok_or("Preset id is required")?
            .to_string();
        let data = serde_json::to_string(&preset).map_err(|error| error.to_string())?;
        db::upsert_json(connection, "jig_presets", &id, &data, None)
    })
}

#[tauri::command]
pub fn delete_jig_preset(state: State<DbState>, id: String) -> Result<(), String> {
    with_connection(&state, |connection| db::delete_row(connection, "jig_presets", &id))
}

#[tauri::command]
pub fn list_export_templates(state: State<DbState>) -> Result<Vec<Value>, String> {
    with_connection(&state, |connection| {
        let rows = db::list_json(connection, "export_templates")?;
        rows.iter()
            .map(|row| serde_json::from_str(row).map_err(|error| error.to_string()))
            .collect()
    })
}

#[tauri::command]
pub fn save_export_template(state: State<DbState>, template: Value) -> Result<(), String> {
    with_connection(&state, |connection| {
        let id = template
            .get("id")
            .and_then(|item| item.as_str())
            .ok_or("Template id is required")?
            .to_string();
        let is_builtin = template
            .get("isBuiltin")
            .and_then(|item| item.as_bool())
            .unwrap_or(false);
        let data = serde_json::to_string(&template).map_err(|error| error.to_string())?;
        db::upsert_json(connection, "export_templates", &id, &data, Some(is_builtin))
    })
}

#[tauri::command]
pub fn delete_export_template(state: State<DbState>, id: String) -> Result<(), String> {
    with_connection(&state, |connection| db::delete_row(connection, "export_templates", &id))
}

#[tauri::command]
pub fn seed_defaults(
    state: State<DbState>,
    jig_presets: Vec<Value>,
    export_templates: Vec<Value>,
) -> Result<(), String> {
    with_connection(&state, |connection| {
        let existing_preset_ids: std::collections::HashSet<String> = db::list_json(connection, "jig_presets")?
            .iter()
            .filter_map(|raw| serde_json::from_str::<Value>(raw).ok())
            .filter_map(|value| value.get("id")?.as_str().map(|id| id.to_string()))
            .collect();

        for preset in jig_presets {
            let id = preset
                .get("id")
                .and_then(|item| item.as_str())
                .ok_or("Preset id is required")?
                .to_string();
            if existing_preset_ids.contains(&id) {
                continue;
            }
            let data = serde_json::to_string(&preset).map_err(|error| error.to_string())?;
            db::upsert_json(connection, "jig_presets", &id, &data, None)?;
        }

        if db::count_rows(connection, "export_templates")? == 0 {
            for template in export_templates {
                let id = template
                    .get("id")
                    .and_then(|item| item.as_str())
                    .ok_or("Template id is required")?
                    .to_string();
                let is_builtin = template
                    .get("isBuiltin")
                    .and_then(|item| item.as_bool())
                    .unwrap_or(false);
                let data = serde_json::to_string(&template).map_err(|error| error.to_string())?;
                db::upsert_json(connection, "export_templates", &id, &data, Some(is_builtin))?;
            }
        }

        Ok(())
    })
}

fn new_master_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("master-{nanos:x}")
}

fn migrate_master_profiles(connection: &rusqlite::Connection) -> Result<(), String> {
    let default_data: Result<String, _> = connection.query_row(
        "SELECT data FROM master_profile WHERE id = 'default'",
        [],
        |row| row.get(0),
    );

    if let Ok(data) = default_data {
        let mut master: Value = serde_json::from_str(&data).map_err(|error| error.to_string())?;
        let id = master
            .get("id")
            .and_then(|value| value.as_str())
            .map(String::from)
            .unwrap_or_else(new_master_id);
        if master.get("id").is_none() {
            master["id"] = Value::String(id.clone());
        }
        let serialized = serde_json::to_string(&master).map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO master_profile (id, data) VALUES (?1, ?2)
                 ON CONFLICT(id) DO UPDATE SET data = excluded.data",
                rusqlite::params![id, serialized],
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute("DELETE FROM master_profile WHERE id = 'default'", [])
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn list_master_profiles(state: State<DbState>) -> Result<Vec<Value>, String> {
    with_connection(&state, |connection| {
        migrate_master_profiles(connection)?;

        let mut statement = connection
            .prepare("SELECT data FROM master_profile ORDER BY id")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;

        let mut masters = Vec::new();
        for row in rows {
            let data = row.map_err(|error| error.to_string())?;
            masters.push(serde_json::from_str(&data).map_err(|error| error.to_string())?);
        }

        Ok(masters)
    })
}

#[tauri::command]
pub fn save_master_profile(state: State<DbState>, master: Value) -> Result<(), String> {
    with_connection(&state, |connection| {
        migrate_master_profiles(connection)?;

        let id = master
            .get("id")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "Master profile id is required".to_string())?
            .to_string();
        let data = serde_json::to_string(&master).map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO master_profile (id, data) VALUES (?1, ?2)
                 ON CONFLICT(id) DO UPDATE SET data = excluded.data",
                rusqlite::params![id, data],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub fn delete_master_profile(state: State<DbState>, id: String) -> Result<(), String> {
    with_connection(&state, |connection| {
        connection
            .execute("DELETE FROM master_profile WHERE id = ?1", rusqlite::params![id])
            .map_err(|error| error.to_string())?;
        Ok(())
    })
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageInput {
    role: String,
    content: String,
}

#[tauri::command]
pub async fn openai_chat_completion(
    messages: Vec<ChatMessageInput>,
    model: Option<String>,
) -> Result<String, String> {
    let api_key =
        std::env::var("OPENAI_API_KEY").map_err(|_| "OPENAI_API_KEY is not set.".to_string())?;
    let model = model.unwrap_or_else(|| "gpt-4o-mini".to_string());

    let payload = json!({
        "model": model,
        "messages": messages,
        "temperature": 0.9,
        "response_format": { "type": "json_object" }
    });

    let client = reqwest::Client::new();
    let response = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("OpenAI request failed: {error}"))?;

    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("OpenAI response parse failed: {error}"))?;

    if !status.is_success() {
        let detail = body
            .pointer("/error/message")
            .and_then(|item| item.as_str())
            .unwrap_or("Unknown OpenAI error");
        return Err(format!("OpenAI API error ({status}): {detail}"));
    }

    body.pointer("/choices/0/message/content")
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|content| !content.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "OpenAI returned an empty response.".to_string())
}

#[tauri::command]
pub async fn test_proxy(proxy_server: String) -> Result<crate::browser::ProxyTestResult, String> {
    crate::browser::test_proxy(proxy_server).await
}

#[tauri::command]
pub async fn geocodio_lookup(
    request: crate::geocodio::GeocodioLookupRequest,
) -> Result<crate::geocodio::GeocodioLookupResult, String> {
    crate::geocodio::lookup(request).await
}

#[tauri::command]
pub async fn test_imap(settings: crate::imap::ImapSettings) -> Result<crate::imap::ImapTestResult, String> {
    tauri::async_runtime::spawn_blocking(move || crate::imap::test_imap(settings))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn fetch_imap_inbox(
    settings: crate::imap::ImapSettings,
    limit: Option<u32>,
) -> Result<Vec<crate::imap::ImapMessage>, String> {
    tauri::async_runtime::spawn_blocking(move || crate::imap::fetch_imap_inbox(settings, limit))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn fetch_imap_message(
    settings: crate::imap::ImapSettings,
    uid: u32,
) -> Result<crate::imap::ImapMessage, String> {
    tauri::async_runtime::spawn_blocking(move || crate::imap::fetch_imap_message(settings, uid))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn launch_browser_session(
    app: AppHandle,
    registry: tauri::State<'_, crate::browser::BrowserSessionRegistry>,
    request: crate::browser::BrowserSessionLaunchRequest,
) -> Result<crate::browser::BrowserSessionLaunchResult, String> {
    let registry = registry.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::browser::launch_browser_session(&app, &registry, request)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn list_running_browser_sessions(
    app: AppHandle,
    registry: tauri::State<'_, crate::browser::BrowserSessionRegistry>,
) -> Vec<String> {
    crate::browser::list_running_browser_sessions(&app, registry.inner())
}

#[tauri::command]
pub async fn check_camoufox(
    app: AppHandle,
    python_path: Option<String>,
) -> Result<crate::browser::CamoufoxCheckResult, String> {
    tauri::async_runtime::spawn_blocking(move || crate::browser::check_camoufox(&app, python_path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn bundled_runtime_info(
    app: AppHandle,
) -> crate::browser::BundledRuntimeInfo {
    crate::browser::bundled_runtime_info(&app)
}

#[tauri::command]
pub async fn activate_license(
    app: AppHandle,
    license_key: String,
) -> Result<crate::license::LicenseStatus, String> {
    crate::license::activate_license(&app, license_key).await
}

#[tauri::command]
pub async fn check_license(app: AppHandle) -> Result<crate::license::LicenseStatus, String> {
    crate::license::check_license(&app).await
}

#[tauri::command]
pub async fn clear_license(app: AppHandle) -> Result<(), String> {
    crate::license::clear_license(&app).await
}

#[tauri::command]
pub fn licensing_required() -> bool {
    crate::license::licensing_required()
}

pub fn init_db(app: &AppHandle, state: &DbState) -> Result<(), String> {
    let connection = db::open_connection(app)?;
    let mut guard = state.0.lock().map_err(|_| "Database lock poisoned".to_string())?;
    *guard = Some(connection);
    Ok(())
}
