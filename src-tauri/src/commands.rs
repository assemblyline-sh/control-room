use std::path::Path;

use tauri_plugin_dialog::DialogExt;

use crate::central_config::{self, CentralConfig, ConfigError, LOCAL_HOST};

#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error("io error: {0}")]
    Io(String),
    #[error("serialize/deserialize error: {0}")]
    Json(String),
    #[error("dialog error: {0}")]
    Dialog(String),
    #[error("pm2 error: {0}")]
    Pm2(String),
    #[error("{0}")]
    Config(String),
    #[error("{0}")]
    Ssh(String),
    /// A guard said no (e.g. the probe refusing a delete) — not an I/O failure.
    #[error("{0}")]
    Refused(String),
    #[error("window error: {0}")]
    Window(String),
}

impl From<ConfigError> for CommandError {
    fn from(e: ConfigError) -> Self {
        match e {
            ConfigError::Invalid(s) => CommandError::Config(s),
            ConfigError::Io(s) => CommandError::Io(s),
        }
    }
}

impl serde::Serialize for CommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// --------------------------- central config ---------------------------

/// The al-control config, or `None` before the first factory is added.
#[tauri::command]
pub async fn load_config() -> Result<Option<CentralConfig>, CommandError> {
    Ok(central_config::load()?)
}

/// Add a factory. `name` defaults to the directory basename (the pm2 name),
/// made unique on that host. Local paths under the home dir are stored as
/// `~/…`, as al-control's config writes them.
#[tauri::command]
pub async fn add_factory(host: String, name: Option<String>, path: String) -> Result<CentralConfig, CommandError> {
    let file = central_config::config_path();
    let stored = if host == LOCAL_HOST {
        central_config::collapse_tilde(Path::new(&path))
    } else {
        path.clone()
    };
    let name = match name.filter(|n| !n.trim().is_empty()) {
        Some(n) => n,
        None => {
            let base = basename(&path);
            central_config::unique_factory_name(central_config::load()?.as_ref(), &host, &base)
        }
    };
    Ok(central_config::add_factory(&file, &host, &name, &stored)?)
}

#[tauri::command]
pub async fn remove_factory(host: String, name: String) -> Result<CentralConfig, CommandError> {
    Ok(central_config::remove_factory(&central_config::config_path(), &host, &name)?)
}

#[tauri::command]
pub async fn add_host(name: String, ssh: String, node: Option<String>) -> Result<CentralConfig, CommandError> {
    Ok(central_config::add_host(&central_config::config_path(), &name, &ssh, node.as_deref())?)
}

fn basename(p: &str) -> String {
    Path::new(p.trim_end_matches(['/', '\\']))
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| p.to_string())
}

#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, CommandError> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Select a factory repo")
            .blocking_pick_folder()
    })
    .await
    .map_err(|e| CommandError::Dialog(e.to_string()))?;

    let Some(file_path) = picked else {
        return Ok(None);
    };
    let path_buf = file_path
        .into_path()
        .map_err(|e| CommandError::Dialog(e.to_string()))?;
    Ok(Some(path_buf.to_string_lossy().into_owned()))
}

