use crate::db;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;
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
        if db::count_rows(connection, "jig_presets")? == 0 {
            for preset in jig_presets {
                let id = preset
                    .get("id")
                    .and_then(|item| item.as_str())
                    .ok_or("Preset id is required")?
                    .to_string();
                let data = serde_json::to_string(&preset).map_err(|error| error.to_string())?;
                db::upsert_json(connection, "jig_presets", &id, &data, None)?;
            }
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

pub fn init_db(app: &AppHandle, state: &DbState) -> Result<(), String> {
    let connection = db::open_connection(app)?;
    let mut guard = state.0.lock().map_err(|_| "Database lock poisoned".to_string())?;
    *guard = Some(connection);
    Ok(())
}
