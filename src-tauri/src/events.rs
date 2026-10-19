// App-wide event emitter for code that runs outside a command's AppHandle
// (the SSH source is called from plain functions). Set once at startup.

use std::sync::OnceLock;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn init(app: AppHandle) {
    let _ = APP.set(app);
}

pub fn emit<P: Serialize + Clone>(event: &str, payload: P) {
    if let Some(app) = APP.get() {
        let _ = app.emit(event, payload);
    }
}
