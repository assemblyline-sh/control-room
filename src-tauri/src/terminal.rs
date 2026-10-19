// Integrated terminal: a shell at a factory folder in a local pseudo-terminal
// — the user's shell for the local host, `ssh -tt <alias> 'cd … && exec
// $SHELL -l'` for a remote one. See docs/wip/integrated-terminal.md.
//
// The one place the webview types into a shell, kept narrow: JS sends
// (host, factory, dir) and keystrokes, never a command. Rust resolves the
// folder from the config (`terminal_dir`, containment-checked), hardcodes
// the binaries and builds the argv. A session belongs to the window that
// opened it.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::commands::CommandError;
use crate::host_commands::{terminal_dir, TerminalDir};
use crate::source::ssh;

struct Session {
    window: String,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct TerminalState(Mutex<HashMap<String, Session>>);

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

/// Output is flushed to the webview at most this often, or at FLUSH_BYTES.
const FLUSH_EVERY: Duration = Duration::from_millis(12);
const FLUSH_BYTES: usize = 64 * 1024;

fn command_for(target: TerminalDir) -> CommandBuilder {
    let mut cmd = match target {
        TerminalDir::Local(path) => {
            // The user's login shell (from $SHELL or passwd).
            let mut c = CommandBuilder::new_default_prog();
            c.cwd(path);
            c
        }
        TerminalDir::Remote(host, path) => {
            let mut args = ssh::ssh_args(&host, true);
            // -tt: ssh's stdin is our PTY, but say so explicitly.
            if let Some(i) = args.iter().position(|a| a == "-t") {
                args.insert(i, "-t".into());
            }
            let mut c = CommandBuilder::new("ssh");
            c.args(&args);
            c.arg(format!(
                "export COLORTERM=truecolor; cd {} && exec \"${{SHELL:-/bin/sh}}\" -l",
                ssh::shell_quote(&path)
            ));
            c
        }
    };
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    // Apps started from Finder get no locale; agents' TUIs need UTF-8.
    if std::env::var_os("LANG").is_none() {
        cmd.env("LANG", "en_US.UTF-8");
    }
    cmd
}

/// Open a terminal session at a factory folder. Output streams to `on_data`
/// as raw bytes; `on_exit` gets the exit code (null when killed by a
/// signal) once the process ends. Returns the session id.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn terminal_open(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, TerminalState>,
    host: String,
    factory: String,
    dir: Option<String>,
    cols: u16,
    rows: u16,
    on_data: Channel<InvokeResponseBody>,
    on_exit: Channel<Option<u32>>,
) -> Result<String, CommandError> {
    let target = terminal_dir(&host, &factory, dir.as_deref())?;
    let cmd = command_for(target);

    let pair = native_pty_system()
        .openpty(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 })
        .map_err(pty_err)?;
    let mut child = pair.slave.spawn_command(cmd).map_err(pty_err)?;
    // Our copy of the slave must close, or the reader never sees EOF.
    drop(pair.slave);
    let reader = pair.master.try_clone_reader().map_err(pty_err)?;
    let writer = pair.master.take_writer().map_err(pty_err)?;

    let id = format!("term-{}", NEXT_SESSION.fetch_add(1, Ordering::Relaxed));
    state.0.lock().unwrap().insert(
        id.clone(),
        Session { window: window.label().to_string(), master: pair.master, writer, killer: child.clone_killer() },
    );

    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || pump(reader, tx));

    let session_id = id.clone();
    std::thread::spawn(move || {
        forward(rx, &on_data);
        let code = child.wait().ok().filter(|s| s.signal().is_none()).map(|s| s.exit_code());
        let _ = on_exit.send(code);
        if let Some(s) = app.try_state::<TerminalState>() {
            s.0.lock().unwrap().remove(&session_id);
        }
    });

    Ok(id)
}

fn pump(mut reader: Box<dyn Read + Send>, tx: mpsc::Sender<Vec<u8>>) {
    let mut buf = [0u8; 16 * 1024];
    loop {
        match reader.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        }
    }
}

/// Coalesce PTY reads (macOS hands them out ~1 KB at a time) into one
/// message per FLUSH_EVERY, so a burst of output doesn't flood IPC.
fn forward(rx: mpsc::Receiver<Vec<u8>>, on_data: &Channel<InvokeResponseBody>) {
    while let Ok(first) = rx.recv() {
        let mut out = first;
        let deadline = Instant::now() + FLUSH_EVERY;
        while out.len() < FLUSH_BYTES {
            let left = deadline.saturating_duration_since(Instant::now());
            match rx.recv_timeout(left) {
                Ok(more) => out.extend_from_slice(&more),
                Err(_) => break,
            }
        }
        if on_data.send(InvokeResponseBody::Raw(out)).is_err() {
            return;
        }
    }
}

fn pty_err(e: impl std::fmt::Display) -> CommandError {
    CommandError::Io(format!("terminal: {}", e))
}

/// Run `f` on a session this window owns.
fn with_session<T>(
    state: &TerminalState,
    window: &str,
    id: &str,
    f: impl FnOnce(&mut Session) -> Result<T, CommandError>,
) -> Result<T, CommandError> {
    let mut map = state.0.lock().unwrap();
    match map.get_mut(id) {
        Some(s) if s.window == window => f(s),
        Some(_) => Err(CommandError::Refused(format!("Terminal {} belongs to another window.", id))),
        None => Err(CommandError::Refused(format!("No terminal {} (it has exited).", id))),
    }
}

#[tauri::command]
pub fn terminal_write(window: WebviewWindow, state: State<'_, TerminalState>, id: String, data: String) -> Result<(), CommandError> {
    with_session(&state, window.label(), &id, |s| {
        s.writer.write_all(data.as_bytes()).and_then(|_| s.writer.flush()).map_err(|e| CommandError::Io(e.to_string()))
    })
}

#[tauri::command]
pub fn terminal_resize(window: WebviewWindow, state: State<'_, TerminalState>, id: String, cols: u16, rows: u16) -> Result<(), CommandError> {
    with_session(&state, window.label(), &id, |s| {
        s.master
            .resize(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| CommandError::Io(e.to_string()))
    })
}

/// Kill a session. Closing an already-exited one is fine.
#[tauri::command]
pub fn terminal_close(window: WebviewWindow, state: State<'_, TerminalState>, id: String) -> Result<(), CommandError> {
    let session = {
        let mut map = state.0.lock().unwrap();
        match map.get(&id) {
            Some(s) if s.window != window.label() => {
                return Err(CommandError::Refused(format!("Terminal {} belongs to another window.", id)))
            }
            _ => map.remove(&id),
        }
    };
    if let Some(mut s) = session {
        let _ = s.killer.kill();
    }
    Ok(())
}

/// Kill a closed window's sessions.
pub fn kill_window_sessions(state: &TerminalState, label: &str) {
    let mut map = state.0.lock().unwrap();
    map.retain(|_, s| {
        if s.window != label {
            return true;
        }
        let _ = s.killer.kill();
        false
    });
}

/// Kill every session — the app is quitting.
pub fn kill_all_sessions(state: &TerminalState) {
    let mut map = state.0.lock().unwrap();
    for (_, mut s) in map.drain() {
        let _ = s.killer.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::central_config::HostEntry;

    fn remote_host() -> HostEntry {
        HostEntry { name: "prod".into(), is_local: false, ssh: Some("prod-box".into()), node: None, factories: vec![] }
    }

    fn argv(cmd: &CommandBuilder) -> Vec<String> {
        cmd.get_argv().iter().map(|a| a.to_string_lossy().into_owned()).collect()
    }

    #[test]
    fn remote_command_quotes_the_folder_and_forces_a_tty() {
        let cmd = command_for(TerminalDir::Remote(remote_host(), "/srv/it's here".into()));
        let a = argv(&cmd);
        assert_eq!(a[0], "ssh");
        let dd = a.iter().position(|x| x == "--").unwrap();
        assert_eq!(a[dd + 1], "prod-box");
        assert_eq!(a.iter().filter(|x| *x == "-t").count(), 2);
        assert_eq!(a.last().unwrap(), &format!("export COLORTERM=truecolor; cd {} && exec \"${{SHELL:-/bin/sh}}\" -l", ssh::shell_quote("/srv/it's here")));
        assert_eq!(cmd.get_env("TERM").unwrap(), "xterm-256color");
    }

    #[test]
    fn only_the_opening_window_can_use_a_session() {
        let pair = native_pty_system().openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).unwrap();
        let child = pair.slave.spawn_command(CommandBuilder::new("/bin/cat")).unwrap();
        let writer = pair.master.take_writer().unwrap();
        let state = TerminalState::default();
        let killer = child.clone_killer();
        state.0.lock().unwrap().insert("t".into(), Session { window: "main".into(), master: pair.master, writer, killer });

        assert!(with_session(&state, "main", "t", |_| Ok(())).is_ok());
        assert!(matches!(with_session(&state, "host-2", "t", |_| Ok(())), Err(CommandError::Refused(_))));
        assert!(matches!(with_session(&state, "main", "nope", |_| Ok(())), Err(CommandError::Refused(_))));
        kill_window_sessions(&state, "main");
        assert!(state.0.lock().unwrap().is_empty());
    }

    #[test]
    fn local_session_round_trips_bytes_and_reports_exit() {
        let pair = native_pty_system().openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).unwrap();
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.args(["-c", "read line; echo \"got:$line\"; exit 3"]);
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        writer.write_all(b"hi\r").unwrap();

        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || pump(reader, tx));
        let status = child.wait().unwrap();
        drop(pair.master);
        let out: Vec<u8> = rx.iter().flatten().collect();
        assert!(String::from_utf8_lossy(&out).contains("got:hi"));
        assert_eq!(status.exit_code(), 3);
    }
}

#[cfg(test)]
mod remote {
    use super::*;

    /// Run `input` in a terminal for `target`; everything it printed.
    fn session_output(target: TerminalDir, input: &str) -> String {
        let pair = native_pty_system().openpty(PtySize { rows: 30, cols: 100, pixel_width: 0, pixel_height: 0 }).unwrap();
        let mut child = pair.slave.spawn_command(command_for(target)).unwrap();
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || pump(reader, tx));
        std::thread::sleep(Duration::from_secs(3));
        writer.write_all(input.as_bytes()).unwrap();
        let status = child.wait().unwrap();
        drop(pair.master);
        let out: Vec<u8> = rx.iter().flatten().collect();
        println!("exit {:?}", status);
        String::from_utf8_lossy(&out).into_owned()
    }

    /// `CR_TEST_HOST=<host> CR_TEST_FACTORY=<factory> CR_TEST_STATION=<code> cargo test -- --ignored remote_terminal --nocapture`
    /// — a real PTY session over ssh to a host in the developer's config.
    #[test]
    #[ignore]
    fn remote_terminal() {
        let host = std::env::var("CR_TEST_HOST").expect("CR_TEST_HOST");
        let factory = std::env::var("CR_TEST_FACTORY").expect("CR_TEST_FACTORY");
        let check = "echo \"fw:$TERM:$COLORTERM:$(pwd)\"; stty size; ";
        let plain = session_output(terminal_dir(&host, &factory, None).unwrap(), &format!("{check}exit\r"));
        println!("{plain}");
        assert!(plain.contains("fw:xterm-256color:truecolor:") && plain.contains(&factory));
        assert!(plain.contains("30 100"));

        if let Ok(code) = std::env::var("CR_TEST_STATION") {
            let station = session_output(terminal_dir(&host, &factory, Some(&code)).unwrap(), "pwd; exit\r");
            assert!(station.contains(&format!("temp/stations/{code}")));
        }
    }
}
