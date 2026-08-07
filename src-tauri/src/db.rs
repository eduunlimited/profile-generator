use rusqlite::{params, Connection};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("profile-generator.db"))
        .map_err(|error| error.to_string())
}

pub fn open_connection(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    init_schema(&connection)?;
    Ok(connection)
}

fn init_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS profiles (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS jig_presets (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS export_templates (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                is_builtin INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS master_profile (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL
            );
            ",
        )
        .map_err(|error| error.to_string())
}

pub fn count_rows(connection: &Connection, table: &str) -> Result<i64, String> {
    connection
        .query_row(
            &format!("SELECT COUNT(*) FROM {table}"),
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

pub fn upsert_json(
    connection: &Connection,
    table: &str,
    id: &str,
    data: &str,
    is_builtin: Option<bool>,
) -> Result<(), String> {
    match table {
        "profiles" => {
            connection
                .execute(
                    "INSERT INTO profiles (id, data, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?3)
                     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
                    params![id, data, chrono_now()],
                )
                .map_err(|error| error.to_string())?;
        }
        "jig_presets" => {
            connection
                .execute(
                    "INSERT INTO jig_presets (id, data) VALUES (?1, ?2)
                     ON CONFLICT(id) DO UPDATE SET data = excluded.data",
                    params![id, data],
                )
                .map_err(|error| error.to_string())?;
        }
        "export_templates" => {
            connection
                .execute(
                    "INSERT INTO export_templates (id, data, is_builtin) VALUES (?1, ?2, ?3)
                     ON CONFLICT(id) DO UPDATE SET data = excluded.data, is_builtin = excluded.is_builtin",
                    params![id, data, is_builtin.unwrap_or(false) as i64],
                )
                .map_err(|error| error.to_string())?;
        }
        _ => return Err(format!("Unknown table: {table}")),
    }
    Ok(())
}

pub fn delete_row(connection: &Connection, table: &str, id: &str) -> Result<(), String> {
    connection
        .execute(
            &format!("DELETE FROM {table} WHERE id = ?1"),
            params![id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn list_json(connection: &Connection, table: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(&format!("SELECT data FROM {table} ORDER BY rowid ASC"))
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(rows)
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", duration.as_secs())
}
