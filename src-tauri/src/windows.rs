// One window per host, VS Code style. A window's host is fixed for its
// life: "main" claims the host it booted on, every other window is opened
// for a host and gets it injected before the page loads.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::central_config;
use crate::commands::CommandError;
use crate::resolve::resolve_host;

/// Window label → the host it shows.
#[derive(Default)]
pub struct WindowHosts(pub Mutex<HashMap<String, String>>);

static NEXT_WINDOW: AtomicU64 = AtomicU64::new(1);

fn title(host: &str) -> String {
    format!("control-room — {}", host)
}

const MENU_HOST_PREFIX: &str = "new-window:";

#[tauri::command]
pub fn claim_window_host(app: AppHandle, window: WebviewWindow, state: State<'_, WindowHosts>, host: String) {
    let _ = window.set_title(&title(&host));
    state.0.lock().unwrap().insert(window.label().to_string(), host);
    refresh_menu(&app);
}

/// Focus the window already showing `host`, or open one for it.
#[tauri::command]
pub fn open_host_window(app: AppHandle, state: State<'_, WindowHosts>, host: String) -> Result<(), CommandError> {
    refresh_menu(&app);
    open(&app, &state, host)
}

fn open(app: &AppHandle, state: &WindowHosts, host: String) -> Result<(), CommandError> {
    resolve_host(&host)?;
    let mut hosts = state.0.lock().unwrap();
    let existing = hosts.iter().find(|(_, h)| **h == host).map(|(label, _)| label.clone());
    if let Some(window) = existing.and_then(|label| app.get_webview_window(&label)) {
        let _ = window.unminimize();
        let _ = window.show();
        return window.set_focus().map_err(|e| CommandError::Window(e.to_string()));
    }

    let label = format!("host-{}", NEXT_WINDOW.fetch_add(1, Ordering::Relaxed));
    let host_json = serde_json::to_string(&host).map_err(|e| CommandError::Json(e.to_string()))?;
    WebviewWindowBuilder::new(app, &label, WebviewUrl::default())
        .title(title(&host))
        .inner_size(1280.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .disable_drag_drop_handler()
        .initialization_script(&format!("window.__CONTROL_ROOM_HOST__ = {};", host_json))
        .build()
        .map_err(|e| CommandError::Window(e.to_string()))?;
    hosts.insert(label, host);
    Ok(())
}

/// Forget a closed window. Returns its host when no other window shows it,
/// so the caller can stop that host's log tails.
pub fn release(state: &WindowHosts, label: &str) -> Option<String> {
    let mut hosts = state.0.lock().unwrap();
    let host = hosts.remove(label)?;
    (!hosts.values().any(|h| *h == host)).then_some(host)
}

/// The OS menu: Tauri's default, with File → New Window ▸ <host>. Rebuilt when a window boots or opens, so a host added
/// since shows up.
pub fn refresh_menu(app: &AppHandle) {
    if let Ok(menu) = build_menu(app) {
        let _ = app.set_menu(menu);
    }
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::default(app)?;
    let names: Vec<String> = central_config::load()
        .ok()
        .flatten()
        .map(|cfg| cfg.hosts.into_iter().map(|h| h.name).collect())
        .unwrap_or_default();
    let new_window = Submenu::new(app, "New Window", !names.is_empty())?;
    for name in &names {
        new_window.append(&MenuItem::with_id(app, format!("{MENU_HOST_PREFIX}{name}"), name, true, None::<&str>)?)?;
    }

    let file = menu
        .items()?
        .into_iter()
        .filter_map(|item| item.as_submenu().cloned())
        .find(|sub| sub.text().map(|t| t == "File").unwrap_or(false));
    let file = match file {
        Some(sub) => sub,
        None => {
            // Linux's default menu has no File menu.
            let sub = Submenu::new(app, "File", true)?;
            menu.insert(&sub, 0)?;
            sub
        }
    };
    file.prepend_items(&[&new_window, &PredefinedMenuItem::separator(app)?])?;
    Ok(menu)
}

pub fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    if let Some(host) = event.id().as_ref().strip_prefix(MENU_HOST_PREFIX) {
        let state = app.state::<WindowHosts>();
        let _ = open(app, &state, host.to_string());
    }
}
