// Per-factory pm2 process control: status, start, stop, restart and live log
// tailing, on this machine or — over the same ssh call as the probe — a
// remote host. The guards match al-control's `procs` (src/cli/procs/actions.js):
// one probe `factories` query finds the factory's process, under pm2 or run
// directly; start refuses when it already runs, stop and restart refuse unless
// it runs under pm2.
//
// `pm2` is invoked as an already-globally-installed CLI binary via plain
// `std::process::Command` — not a Cargo dependency, not routed through the
// `@tauri-apps/plugin-shell` JS-invokable capability. Capability grants only
// gate what the webview's JS can invoke directly; a `std::process::Command`
// call made from inside an already-registered `#[tauri::command]` body needs
// no capability entry at all.

use std::collections::HashMap;
use std::io::BufRead;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::central_config::HostEntry;
use crate::commands::CommandError;
use crate::resolve::resolve;
use crate::source::{probe, ssh};

/// A factory's host and its path there, as configured (`~` resolves on the
/// host).
struct Target {
    host: HostEntry,
    path: String,
    name: String,
}

fn target(host: &str, factory: &str) -> Result<Target, CommandError> {
    let r = resolve(host, factory)?;
    Ok(Target { host: r.host, path: r.factory.path, name: r.factory.name })
}

/// The factory as the probe sees it on its host.
#[derive(Debug, Clone)]
struct Inspect {
    root: String,
    /// package.json `main`, when the folder is a factory.
    main: Option<String>,
    pm2_found: bool,
    /// pm2 process name = the root's directory basename (the shared rule, so
    /// al-control and this app address the same pm2 app).
    pm2_name: String,
    running: Option<Running>,
}

/// The factory's process, from the probe's `procs`.
#[derive(Debug, Clone)]
struct Running {
    pid: String,
    /// `pm2` or `direct`
    mode: String,
    /// pm2 app name; `-` when run directly
    pm2: String,
    cpu: Option<f64>,
    memory: Option<u64>,
}

impl Target {
    fn inspect(&self) -> Result<Inspect, CommandError> {
        let data = probe::probe(&self.host, serde_json::json!({ "type": "factories", "paths": { self.name.as_str(): self.path } }))?;
        let w = &data["factories"][0];
        if w["exists"] != true {
            return Err(CommandError::Pm2(format!("{} doesn't exist on {}", self.path, self.host.name)));
        }
        let root = w["root"].as_str().unwrap_or_default().to_string();
        let pm2_name = std::path::Path::new(&root).file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let running = data["procs"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|p| p["cwd"].as_str() == Some(root.as_str()) || p["pm2"].as_str() == Some(pm2_name.as_str()))
            .map(|p| Running {
                pid: p["pid"].as_str().map(String::from).unwrap_or_else(|| p["pid"].to_string()),
                mode: p["mode"].as_str().unwrap_or_default().to_string(),
                pm2: p["pm2"].as_str().unwrap_or("-").to_string(),
                cpu: p["cpu"].as_f64(),
                memory: p["memory"].as_u64(),
            });
        Ok(Inspect { main: w["main"].as_str().map(String::from), pm2_found: data["pm2_found"] == true, root, pm2_name, running })
    }

    /// Run `pm2 <args>` (from `cwd` when given); returns stdout. Local runs put
    /// this machine's node first on PATH; remote runs go through `ssh` with the
    /// host's `node:` dir on PATH.
    fn run(&self, args: &[&str], cwd: Option<&str>) -> Result<Vec<u8>, CommandError> {
        let host = &self.host;
        if host.is_local {
            let mut cmd = local_pm2(host);
            cmd.args(args);
            if let Some(dir) = cwd {
                cmd.current_dir(dir);
            }
            let out = cmd.output().map_err(map_pm2_spawn_error)?;
            if !out.status.success() {
                return Err(CommandError::Pm2(format!("pm2 {} exited with status {}", args[0], out.status)));
            }
            return Ok(out.stdout);
        }
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

/// `pm2` on this machine: the one next to the node the probe uses (an app
/// opened from the Finder has a bare PATH), else whatever is on PATH.
fn local_pm2(host: &HostEntry) -> Command {
    let node = probe::local_node(host);
    let beside = std::path::Path::new(&node).with_file_name("pm2");
    let program = if beside.is_file() { beside.display().to_string() } else { "pm2".to_string() };
    probe::with_node_path(Command::new(program), &node)
}

/// The local host from the config, or a bare one before there is a config.
fn local_host() -> HostEntry {
    crate::central_config::load()
        .ok()
        .flatten()
        .and_then(|c| c.hosts.into_iter().find(|h| h.is_local))
        .unwrap_or(HostEntry { name: "local".into(), is_local: true, ssh: None, node: None, factories: vec![] })
}

/// What `pm2 start` runs, or why it mustn't: not a factory, pm2 missing, or
/// already running (under pm2 or directly).
fn check_start<'a>(i: &'a Inspect, factory: &str, host: &str) -> Result<&'a str, CommandError> {
    let Some(main) = i.main.as_deref() else {
        return Err(CommandError::Pm2(format!(
            "{} on {} isn't a factory (no @assemblyline/lib-factory dependency or package.json \"main\")",
            i.root, host
        )));
    };
    if !i.pm2_found {
        return Err(CommandError::Pm2(format!("pm2 not found on {}.", host)));
    }
    if let Some(r) = &i.running {
        return Err(CommandError::Refused(format!(
            "{} is already running on {} (pid {}, {}). Use Restart instead.",
            factory,
            host,
            r.pid,
            if r.mode == "pm2" { "under pm2" } else { "run directly" }
        )));
    }
    Ok(main)
}

/// The pm2 app to stop or restart, or why it can't be: not running, or run
/// directly (pm2 can't manage it).
fn check_managed<'a>(i: &'a Inspect, factory: &str, host: &str) -> Result<&'a str, CommandError> {
    if !i.pm2_found {
        return Err(CommandError::Pm2(format!("pm2 not found on {}.", host)));
    }
    match &i.running {
        None => Err(CommandError::Refused(format!("{} is not running on {}.", factory, host))),
        Some(r) if r.mode != "pm2" => Err(CommandError::Refused(format!(
            "{} (pid {}) is running directly, not under pm2, so it can't be managed here. Stop it on {}: kill {}",
            factory, r.pid, host, r.pid
        ))),
        Some(r) => Ok(r.pm2.as_str()),
    }
}

/// Tracks in-flight `pm2 logs --raw` tail subprocesses (an `ssh` child for
/// a remote host), keyed by
/// `host/factory` (the same factory name can exist on two hosts), so a tab
/// close (or app quit) can kill the right one.
#[derive(Default)]
pub struct LogTailState(pub Mutex<HashMap<String, Child>>);

fn map_pm2_spawn_error(e: std::io::Error) -> CommandError {
    if e.kind() == std::io::ErrorKind::NotFound {
        CommandError::Pm2("pm2 not found — install with `npm i -g pm2`".into())
    } else {
        CommandError::Pm2(e.to_string())
    }
}

#[tauri::command]
pub async fn check_pm2_available() -> Result<bool, CommandError> {
    match local_pm2(&local_host()).arg("--version").stdout(Stdio::null()).stderr(Stdio::null()).status() {
        Ok(status) => Ok(status.success()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(CommandError::Pm2(e.to_string())),
    }
}

/// Start under pm2 from the factory root. Refused when it already runs.
#[tauri::command]
pub async fn factory_start(host: String, factory: String) -> Result<(), CommandError> {
    let t = target(&host, &factory)?;
    let i = t.inspect()?;
    let main = check_start(&i, &factory, &host)?;
    // `cwd` on the `pm2 start` itself is the single source of truth for the
    // process's `pm_cwd` — what `cd <dir> && pm2 start` would give.
    t.run(&["start", main, "--name", &i.pm2_name], Some(&i.root))?;
    Ok(())
}

/// Refused unless the factory runs under pm2.
#[tauri::command]
pub async fn factory_stop(host: String, factory: String) -> Result<(), CommandError> {
    let t = target(&host, &factory)?;
    let i = t.inspect()?;
    t.run(&["stop", check_managed(&i, &factory, &host)?], None)?;
    Ok(())
}

/// Refused unless the factory runs under pm2.
#[tauri::command]
pub async fn factory_restart(host: String, factory: String) -> Result<(), CommandError> {
    let t = target(&host, &factory)?;
    let i = t.inspect()?;
    t.run(&["restart", check_managed(&i, &factory, &host)?], None)?;
    Ok(())
}

#[derive(Serialize)]
pub struct FactoryProcessStatus {
    /// "online" (under pm2), "direct" (run outside pm2) or "stopped"
    pub status: String,
    pub pid: Option<String>,
    pub cpu: Option<f64>,
    pub memory: Option<u64>,
}

/// The factory's process, from one probe `factories` query (the same answer
/// al-control's `procs list` gives).
#[tauri::command]
pub async fn factory_status(host: String, factory: String) -> Result<FactoryProcessStatus, CommandError> {
    let i = target(&host, &factory)?.inspect()?;
    Ok(match i.running {
        Some(r) => FactoryProcessStatus {
            status: if r.mode == "pm2" { "online".into() } else { "direct".into() },
            pid: Some(r.pid),
            cpu: r.cpu,
            memory: r.memory,
        },
        None => FactoryProcessStatus { status: "stopped".into(), pid: None, cpu: None, memory: None },
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
    let name = t.inspect()?.pm2_name;
    let key = format!("{}/{}", host, factory);

    {
        let map = state.0.lock().unwrap();
        if map.contains_key(&key) {
            return Ok(()); // already tailing — idempotent (guards StrictMode double-invoke)
        }
    }

    let mut cmd = if t.host.is_local {
        let mut c = local_pm2(&t.host);
        c.args(["logs", &name, "--raw"]);
        c
    } else {
        let mut c = Command::new("ssh");
        c.args(ssh::ssh_args(&t.host, false))
            .arg(format!("{}pm2 logs {} --raw", ssh::env_prefix(&t.host), ssh::shell_quote(&name)));
        c
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
mod tests {
    use super::*;

    fn inspect(running: Option<(&str, &str)>) -> Inspect {
        Inspect {
            root: "/f/factory-acme".into(),
            main: Some("src/index.js".into()),
            pm2_found: true,
            pm2_name: "factory-acme".into(),
            running: running.map(|(mode, pm2)| Running { pid: "42".into(), mode: mode.into(), pm2: pm2.into(), cpu: None, memory: None }),
        }
    }

    #[test]
    fn start_refuses_a_running_factory_and_anything_not_a_factory() {
        assert_eq!(check_start(&inspect(None), "acme", "local").unwrap(), "src/index.js");
        for running in [("pm2", "factory-acme"), ("direct", "-")] {
            let err = check_start(&inspect(Some(running)), "acme", "local").unwrap_err();
            assert!(matches!(err, CommandError::Refused(ref m) if m.contains("already running") && m.contains("pid 42")), "{:?}", err);
        }
        let not_factory = Inspect { main: None, ..inspect(None) };
        assert!(matches!(check_start(&not_factory, "acme", "local"), Err(CommandError::Pm2(_))));
        let no_pm2 = Inspect { pm2_found: false, ..inspect(None) };
        assert!(matches!(check_start(&no_pm2, "acme", "local"), Err(CommandError::Pm2(_))));
    }

    #[test]
    fn stop_and_restart_need_a_pm2_process() {
        assert_eq!(check_managed(&inspect(Some(("pm2", "acme-app"))), "acme", "local").unwrap(), "acme-app");
        let err = check_managed(&inspect(None), "acme", "local").unwrap_err();
        assert!(matches!(err, CommandError::Refused(ref m) if m.contains("not running")), "{:?}", err);
        let err = check_managed(&inspect(Some(("direct", "-"))), "acme", "local").unwrap_err();
        assert!(matches!(err, CommandError::Refused(ref m) if m.contains("running directly") && m.contains("kill 42")), "{:?}", err);
    }
}

#[cfg(test)]
mod remote {
    /// `cargo test -- --ignored remote_pm2 --nocapture` — process status of
    /// every factory on every host in the developer's config (read-only).
    #[test]
    #[ignore]
    fn remote_pm2_status() {
        let cfg = crate::central_config::load().unwrap().expect("config");
        let rt = tauri::async_runtime::block_on(async {
            let mut out = Vec::new();
            for h in &cfg.hosts {
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
