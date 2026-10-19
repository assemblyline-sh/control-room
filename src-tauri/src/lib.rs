mod central_config;
mod commands;
mod events;
mod failures;
mod housekeeping;
mod host_commands;
mod monitor;
mod monitor_commands;
mod pm2;
mod requeue;
mod resolve;
mod source;
mod terminal;
mod ui_fixtures;
mod windows;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(pm2::LogTailState::default())
        .manage(windows::WindowHosts::default())
        .manage(terminal::TerminalState::default())
        .setup(|app| {
            events::init(app.handle().clone());
            windows::refresh_menu(app.handle());
            Ok(())
        })
        .on_menu_event(windows::on_menu_event)
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                terminal::kill_window_sessions(&app.state::<terminal::TerminalState>(), window.label());
                if let Some(host) = windows::release(&app.state::<windows::WindowHosts>(), window.label()) {
                    pm2::kill_host_log_tails(&app.state::<pm2::LogTailState>(), &host);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_config,
            commands::add_factory,
            commands::remove_factory,
            commands::add_host,
            host_commands::test_host,
            host_commands::check_factory_path,
            host_commands::open_terminal,
            host_commands::fetch_file,
            host_commands::read_file_bytes,
            commands::pick_folder,
            monitor_commands::list_lines,
            monitor_commands::show_line,
            monitor_commands::show_station,
            monitor_commands::list_bin_workpieces,
            monitor_commands::show_workpiece,
            monitor_commands::list_files_in_workpiece,
            monitor_commands::factory_orchestrator,
            monitor_commands::read_file,
            monitor_commands::host_counts,
            failures::list_failures,
            housekeeping::plan_clear,
            housekeeping::clear_workpieces,
            requeue::requeue_workpieces,
            pm2::check_pm2_available,
            pm2::factory_start,
            pm2::factory_stop,
            pm2::factory_status,
            pm2::start_log_tail,
            pm2::stop_log_tail,
            terminal::terminal_open,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close,
            windows::claim_window_host,
            windows::open_host_window,
        ])
        .build(tauri::generate_context!())
        .expect("error while building control-room")
        .run(|app_handle, event| {
            // Kill any still-tailing `pm2 logs --raw` subprocesses on quit —
            // they don't affect the pm2-managed factory itself, just the tail.
            // Terminal sessions go too (a persistent one's tmux lives on).
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app_handle.try_state::<pm2::LogTailState>() {
                    pm2::kill_all_log_tails(&state);
                }
                if let Some(state) = app_handle.try_state::<terminal::TerminalState>() {
                    terminal::kill_all_sessions(&state);
                }
            }
        });
}
