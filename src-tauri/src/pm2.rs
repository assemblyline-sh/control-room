// Per-factory pm2 process control: start/stop/status + live log tailing,
// on this machine or — over the same ssh call as the probe — a remote host.
//
// `pm2` is invoked as an already-globally-installed CLI binary via plain
// `std::process::Command` — not a Cargo dependency, not routed through the
// `@tauri-apps/plugin-shell` JS-invokable capability. Capability grants only
// gate what the webview's JS can invoke directly; a `std::process::Command`
// call made from inside an already-registered `#[tauri::command]` body needs
// no capability entry at all (same as how `read_file`'s containment check is
// manual Rust-side logic, not a declared `fs:*` capability scope). See
// docs/wip/pm2-process-controls.md for the full reasoning.

use std::collections::HashMap;
use std::io::BufRead;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::central_config::HostEntry;
use crate::commands::CommandError;
use crate::resolve::resolve;
use crate::source::{probe, ssh};

/// Where a factory's pm2 lives. Remote `path` is as configured (`~` resolves
/// on the host).
enum Target {
    Local { root: String },
    Remote { host: HostEntry, path: String },
}

fn target(host: &str, factory: &str) -> Result<Target, CommandError> {
    let r = resolve(host, factory)?;
    Ok(match r.factory.abs_path {
        Some(root) if r.host.is_local => Target::Local { root },
        _ => Target::Remote { path: r.factory.path, host: r.host },
    })
}

impl Target {
    /// pm2 process name = factory directory basename (the shared rule).
    fn pm2_name(&self) -> String {
        match self {
            Target::Local { root } => pm2_name(root),
            Target::Remote { path, .. } => pm2_name(path),
        }
    }

    /// Run `pm2 <args>` (from `cwd` when given); returns stdout. Remote runs
    /// go through `ssh` with the host's `node:` dir on PATH.
    fn run(&self, args: &[&str], cwd: Option<&str>) -> Result<Vec<u8>, CommandError> {
        match self {
            Target::Local { .. } => {
                let mut cmd = Command::new("pm2");
                cmd.args(args);
                if let Some(dir) = cwd {
                    cmd.current_dir(dir);
                }
                let out = cmd.output().map_err(map_pm2_spawn_error)?;
                if !out.status.success() {
                    return Err(CommandError::Pm2(format!("pm2 {} exited with status {}", args[0], out.status)));
                }
                Ok(out.stdout)
            }
            Target::Remote { host, .. } => {
                let cd = cwd.map(|d| format!("cd {} && ", ssh::shell_quote(d))).unwrap_or_default();
                let quoted: Vec<String> = args.iter().map(|a| ssh::shell_quote(a)).collect();
                let remote_cmd = format!("{}{}pm2 {}", cd, ssh::env_prefix(host), quoted.join(" "));
                let (code, out, err) = ssh::run(host, &remote_cmd, "")?;
                match code {
                    0 => Ok(out),
                    255 => Err(CommandError::Ssh(format!("ssh to {} failed: {}", host.name, err.join(" / ")))),
                    127 => Err(CommandError::Pm2(format!(
                        "pm2 not found on {}. Set 'node:' for this host in the config to the node pm2 was installed with.",
                        host.name
                    ))),
                    _ => Err(CommandError::Pm2(format!("pm2 {} on {} exited with status {}", args[0], host.name, code))),
                }
            }
        }
    }
}

/// Tracks in-flight `pm2 logs --raw` tail subprocesses (an `ssh` child for
/// a remote host), keyed by
/// `host/factory` (the same factory name can exist on two hosts), so a tab
/// close (or app quit) can kill the right one.
#[derive(Default)]
pub struct LogTailState(pub Mutex<HashMap<String, Child>>);

/// Canonical pm2 process name for a factory repo: the directory basename.
/// Must match what `al-control procs start` computes for the same repo path
/// (al-control's `src/cli/procs/actions.js`) so a factory started via the CLI
/// and one started via this app's Play button resolve to the same pm2 app.
fn pm2_name(factory_path: &str) -> String {
    Path::new(factory_path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| factory_path.to_string())
}

fn factory_main_entry(factory_path: &str) -> Result<String, CommandError> {
    let pkg_path = Path::new(factory_path).join("package.json");
    let contents =
        std::fs::read_to_string(&pkg_path).map_err(|e| CommandError::Io(e.to_string()))?;
    let json: serde_json::Value =
        serde_json::from_str(&contents).map_err(|e| CommandError::Json(e.to_string()))?;
    json.get("main")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| CommandError::Pm2("package.json missing a \"main\" field".into()))
}

fn map_pm2_spawn_error(e: std::io::Error) -> CommandError {
    if e.kind() == std::io::ErrorKind::NotFound {
        CommandError::Pm2("pm2 not found — install with `npm i -g pm2`".into())
    } else {
        CommandError::Pm2(e.to_string())
    }
}

#[tauri::command]
pub async fn check_pm2_available() -> Result<bool, CommandError> {
    match Command::new("pm2")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
    {
        Ok(status) => Ok(status.success()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(CommandError::Pm2(e.to_string())),
    }
}

#[tauri::command]
pub async fn factory_start(host: String, factory: String) -> Result<(), CommandError> {
    let t = target(&host, &factory)?;
    // `cwd` on the `pm2 start` itself is the single source of truth for the
    // process's `pm_cwd` — what `cd <dir> && pm2 start` would give.
    let (root, main) = match &t {
        Target::Local { root } => (root.clone(), factory_main_entry(root)?),
        Target::Remote { host, path } => {
            // The probe resolves `~` and reads package.json on the host.
            let data = probe::probe(host, serde_json::json!({ "type": "factories", "paths": { factory.as_str(): path } }))?;
            let w = &data["factories"][0];
            if w["exists"] != true {
                return Err(CommandError::Pm2(format!("{} doesn't exist on {}", path, host.name)));
            }
            let main = w["main"].as_str().ok_or_else(|| {
                CommandError::Pm2(format!("{} on {} isn't a factory (no @assemblyline/lib-factory + main)", path, host.name))
            })?;
            (w["root"].as_str().unwrap_or_default().to_string(), main.to_string())
        }
    };
    t.run(&["start", &main, "--name", &t.pm2_name()], Some(&root))?;
    Ok(())
}

#[tauri::command]
pub async fn factory_stop(host: String, factory: String) -> Result<(), CommandError> {
    let t = target(&host, &factory)?;
    t.run(&["stop", &t.pm2_name()], None)?;
    Ok(())
}

#[derive(Serialize)]
pub struct FactoryProcessStatus {
    pub status: String, // "online" | "stopped" | "errored" | "not_found" | ...
    pub pid: Option<u32>,
    pub cpu: Option<f64>,
    pub memory: Option<u64>,
    pub uptime_ms: Option<i64>,
}

#[derive(Deserialize)]
struct Pm2EnvJson {
    status: Option<String>,
    pm_uptime: Option<i64>,
}

#[derive(Deserialize)]
struct Pm2MonitJson {
    cpu: Option<f64>,
    memory: Option<u64>,
}

#[derive(Deserialize)]
struct Pm2AppJson {
    name: String,
    pid: Option<u32>,
    pm2_env: Pm2EnvJson,
    monit: Option<Pm2MonitJson>,
}

fn pm2_jlist(t: &Target) -> Result<Vec<Pm2AppJson>, CommandError> {
    serde_json::from_slice(&t.run(&["jlist"], None)?).map_err(|e| CommandError::Json(e.to_string()))
}

#[tauri::command]
pub async fn factory_status(host: String, factory: String) -> Result<FactoryProcessStatus, CommandError> {
    let t = target(&host, &factory)?;
    let name = t.pm2_name();
    let apps = pm2_jlist(&t)?;
    let Some(app) = apps.into_iter().find(|a| a.name == name) else {
        return Ok(FactoryProcessStatus {
            status: "not_found".into(),
            pid: None,
            cpu: None,
            memory: None,
            uptime_ms: None,
        });
    };
    Ok(FactoryProcessStatus {
        status: app.pm2_env.status.unwrap_or_else(|| "unknown".into()),
        pid: app.pid,
        cpu: app.monit.as_ref().and_then(|m| m.cpu),
        memory: app.monit.as_ref().and_then(|m| m.memory),
        uptime_ms: app.pm2_env.pm_uptime,
    })
}

#[tauri::command]
pub async fn start_log_tail(
    app: AppHandle,
    state: State<'_, LogTailState>,
    host: String,
    factory: String,
) -> Result<(), CommandError> {
    let t = target(&host, &factory)?;
    let name = t.pm2_name();
    let key = format!("{}/{}", host, factory);

    {
        let map = state.0.lock().unwrap();
        if map.contains_key(&key) {
            return Ok(()); // already tailing — idempotent (guards StrictMode double-invoke)
        }
    }

    let mut cmd = match &t {
        Target::Local { .. } => {
            let mut c = Command::new("pm2");
            c.args(["logs", &name, "--raw"]);
            c
        }
        Target::Remote { host, .. } => {
            let mut c = Command::new("ssh");
            c.args(ssh::ssh_args(host, false))
                .arg(format!("{}pm2 logs {} --raw", ssh::env_prefix(host), ssh::shell_quote(&name)));
            c
        }
    };
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(map_pm2_spawn_error)?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| CommandError::Pm2("failed to capture pm2 logs stdout".into()))?;

    {
        let mut map = state.0.lock().unwrap();
        map.insert(key.clone(), child);
    }

    let thread_key = key;
    std::thread::spawn(move || {
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let _ = app.emit(
                "pm2-log",
                serde_json::json!({ "key": thread_key, "line": line }),
            );
        }
        let _ = app.emit("pm2-log-closed", serde_json::json!({ "key": thread_key }));
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_log_tail(
    state: State<'_, LogTailState>,
    host: String,
    factory: String,
) -> Result<(), CommandError> {
    let child = {
        let mut map = state.0.lock().unwrap();
        map.remove(&format!("{}/{}", host, factory))
    };
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

/// Kill every still-tracked log-tail subprocess. Called on app exit so a
/// tailing `pm2 logs --raw` process doesn't outlive the window. Killing it
/// only stops the log stream — the pm2-managed factory itself is unaffected.
pub fn kill_all_log_tails(state: &LogTailState) {
    let mut map = state.0.lock().unwrap();
    for (_, mut child) in map.drain() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Kill the log tails of one host — its window closed.
pub fn kill_host_log_tails(state: &LogTailState, host: &str) {
    let prefix = format!("{}/", host);
    let mut map = state.0.lock().unwrap();
    map.retain(|key, child| {
        if !key.starts_with(&prefix) {
            return true;
        }
        let _ = child.kill();
        let _ = child.wait();
        false
    });
}

#[cfg(test)]
mod remote {
    /// `cargo test -- --ignored remote_pm2 --nocapture` — pm2 status of every
    /// remote factory in the developer's config (read-only).
    #[test]
    #[ignore]
    fn remote_pm2_status() {
        let cfg = crate::central_config::load().unwrap().expect("config");
        let rt = tauri::async_runtime::block_on(async {
            let mut out = Vec::new();
            for h in cfg.hosts.iter().filter(|h| !h.is_local) {
                for w in &h.factories {
                    let s = super::factory_status(h.name.clone(), w.name.clone()).await.unwrap();
                    out.push(format!("{}/{}: {} pid {:?} mem {:?}", h.name, w.name, s.status, s.pid, s.memory));
                }
            }
            out
        });
        for l in rt {
            println!("{}", l);
        }
    }
}
