// Commands about hosts rather than one factory's data: checking a host or a
// factory path before it goes into the config, and opening a terminal at a
// factory or workpiece folder (a local Terminal, or one running `ssh -t`).

use serde::Serialize;

use crate::central_config::HostEntry;
use crate::commands::CommandError;
use crate::resolve::resolve;
use crate::source::local::stations_path;
use crate::source::ssh;

#[derive(Serialize)]
pub struct HostCheck {
    /// pm2 answered — start/stop/logs will work.
    pub pm2_found: bool,
    /// factories running there, by directory name.
    pub running: Vec<String>,
}

/// One probe round trip to an alias not (yet) in the config.
#[tauri::command]
pub async fn test_host(ssh: String, node: Option<String>) -> Result<HostCheck, CommandError> {
    if ssh.is_empty() || ssh.starts_with('-') {
        return Err(CommandError::Config(format!("Invalid ssh alias '{}'.", ssh)));
    }
    let host = HostEntry {
        name: ssh.clone(),
        is_local: false,
        ssh: Some(ssh),
        node: node.filter(|n| !n.is_empty()),
        factories: vec![],
    };
    let data = ssh::probe(&host, serde_json::json!({ "type": "factories", "paths": {} }))?;
    Ok(HostCheck {
        pm2_found: data["pm2_found"] == true,
        running: data["procs"]
            .as_array()
            .map(|a| a.iter().filter_map(|p| p["factory"].as_str().map(String::from)).collect())
            .unwrap_or_default(),
    })
}

#[derive(Serialize)]
pub struct PathCheck {
    pub exists: bool,
    /// package.json `main` when the dir is a factory (has @assemblyline/lib-factory).
    pub main: Option<String>,
    /// The path with `~` resolved on the host.
    pub root: String,
}

/// Before adding a factory on a remote host: does the path exist there, and
/// is it a factory?
#[tauri::command]
pub async fn check_factory_path(host: String, path: String) -> Result<PathCheck, CommandError> {
    let cfg = crate::central_config::load()?.ok_or_else(|| CommandError::Config("No config yet.".into()))?;
    let h = cfg
        .hosts
        .into_iter()
        .find(|h| h.name == host)
        .ok_or_else(|| CommandError::Config(format!("No host named '{}'.", host)))?;
    if h.is_local {
        let p = crate::central_config::expand_tilde(&path);
        return Ok(PathCheck { exists: p.exists(), main: None, root: p.display().to_string() });
    }
    let data = ssh::probe(&h, serde_json::json!({ "type": "factories", "paths": { "candidate": path } }))?;
    let w = &data["factories"][0];
    Ok(PathCheck {
        exists: w["exists"] == true,
        main: w["main"].as_str().map(String::from),
        root: w["root"].as_str().unwrap_or_default().to_string(),
    })
}

/// Where a terminal for a factory opens: its root, or `dir` (relative to
/// temp/stations/) inside it. Local: the folder, containment-checked.
/// Remote: the path on the host, `~` resolved by the probe.
pub enum TerminalDir {
    Local(std::path::PathBuf),
    Remote(HostEntry, String),
}

pub fn terminal_dir(host: &str, factory: &str, dir: Option<&str>) -> Result<TerminalDir, CommandError> {
    let r = resolve(host, factory)?;
    if r.host.is_local {
        let root = std::path::PathBuf::from(r.factory.abs_path.unwrap_or_default());
        return Ok(TerminalDir::Local(match dir {
            Some(d) => stations_path(&root, d)?,
            None => root,
        }));
    }

    let data = ssh::probe(&r.host, serde_json::json!({ "type": "factories", "paths": { factory: r.factory.path } }))?;
    let root = data["factories"][0]["root"].as_str().unwrap_or_default().to_string();
    let target = match dir {
        Some(d) => {
            if d.split('/').any(|seg| seg == ".." || seg.is_empty()) {
                return Err(CommandError::Io(format!("Refusing to open outside temp/stations/: {}", d)));
            }
            format!("{}/temp/stations/{}", root, d)
        }
        None => root,
    };
    Ok(TerminalDir::Remote(r.host, target))
}

/// The OS terminal app at a factory folder (see `terminal_dir`). Local:
/// Terminal at the folder. Remote: Terminal running
/// `ssh -t <alias> 'cd <dir> && exec $SHELL -l'`. Binaries are hardcoded.
#[tauri::command]
pub async fn open_terminal(host: String, factory: String, dir: Option<String>) -> Result<(), CommandError> {
    match terminal_dir(&host, &factory, dir.as_deref())? {
        TerminalDir::Local(path) => spawn_terminal_at(&path.display().to_string()),
        TerminalDir::Remote(h, target) => {
            let remote = format!("cd {} && exec \"${{SHELL:-/bin/sh}}\" -l", ssh::shell_quote(&target));
            let mut argv = vec!["ssh".to_string()];
            argv.extend(ssh::ssh_args(&h, true));
            argv.push(remote);
            spawn_terminal_running(&argv)
        }
    }
}

/// A local path for a factory file, to hand to the OS (open in the default
/// app). Local factories: the file itself. Remote: fetched through the probe
/// (20 MB cap) into a per-host temp folder.
#[tauri::command]
pub async fn fetch_file(host: String, factory: String, file_path: String) -> Result<String, CommandError> {
    let r = resolve(&host, &factory)?;
    if r.host.is_local {
        let root = std::path::PathBuf::from(r.factory.abs_path.unwrap_or_default());
        let abs = crate::source::local::lexical(&root.join(&file_path));
        if !abs.starts_with(crate::source::local::lexical(&root)) {
            return Err(CommandError::Io(format!("refused to read outside factory repo: {}", file_path)));
        }
        return Ok(abs.display().to_string());
    }

    let rel = file_path
        .strip_prefix("temp/stations/")
        .ok_or_else(|| CommandError::Io(format!("Only workpiece files can be fetched: {}", file_path)))?;
    let mut parts = rel.splitn(3, '/');
    let (Some(station), Some(bin), Some(file)) = (parts.next(), parts.next(), parts.next()) else {
        return Err(CommandError::Io(format!("Not a workpiece file: {}", file_path)));
    };
    let data = ssh::probe(
        &r.host,
        serde_json::json!({ "type": "read", "path": r.factory.path, "dir": format!("{}/{}", station, bin), "file": file }),
    )?;
    let content = data["content"].as_str().unwrap_or_default();
    let bytes = if data["encoding"] == "base64" {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD
            .decode(content)
            .map_err(|e| CommandError::Io(e.to_string()))?
    } else {
        content.as_bytes().to_vec()
    };
    // <tmp>/control-room-files/<host>/<factory>/<path inside temp/stations>
    let dest = std::env::temp_dir().join("control-room-files").join(&host).join(&factory).join(rel);
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir).map_err(|e| CommandError::Io(e.to_string()))?;
    }
    std::fs::write(&dest, bytes).map_err(|e| CommandError::Io(e.to_string()))?;
    Ok(dest.display().to_string())
}

/// A factory file's bytes, for viewing in the app (PDFs). Same containment
/// and remote fetch as `fetch_file`; raw bytes over IPC, not JSON.
#[tauri::command]
pub async fn read_file_bytes(host: String, factory: String, file_path: String) -> Result<tauri::ipc::Response, CommandError> {
    const CAP: u64 = 20 * 1024 * 1024;
    let path = fetch_file(host, factory, file_path).await?;
    let size = std::fs::metadata(&path).map_err(|e| CommandError::Io(e.to_string()))?.len();
    if size > CAP {
        return Err(CommandError::Io(format!("File is {} MB; the in-app viewer stops at 20 MB", size / 1024 / 1024)));
    }
    let bytes = std::fs::read(&path).map_err(|e| CommandError::Io(e.to_string()))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(target_os = "macos")]
fn spawn_terminal_at(dir: &str) -> Result<(), CommandError> {
    std::process::Command::new("open")
        .args(["-a", "Terminal", dir])
        .spawn()
        .map(|_| ())
        .map_err(|e| CommandError::Io(e.to_string()))
}

#[cfg(not(target_os = "macos"))]
fn spawn_terminal_at(dir: &str) -> Result<(), CommandError> {
    std::process::Command::new("x-terminal-emulator")
        .current_dir(dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| CommandError::Io(e.to_string()))
}

/// macOS Terminal can't be handed an argv, so write it to a throwaway
/// `.command` script (each arg shell-quoted) and open that.
#[cfg(target_os = "macos")]
fn spawn_terminal_running(argv: &[String]) -> Result<(), CommandError> {
    use std::os::unix::fs::PermissionsExt;
    let script = std::env::temp_dir().join(format!("control-room-{}.command", std::process::id()));
    let line: Vec<String> = argv.iter().map(|a| ssh::shell_quote(a)).collect();
    std::fs::write(&script, format!("#!/bin/sh\nrm -f \"$0\"\nexec {}\n", line.join(" ")))
        .map_err(|e| CommandError::Io(e.to_string()))?;
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).map_err(|e| CommandError::Io(e.to_string()))?;
    std::process::Command::new("open")
        .args(["-a", "Terminal"])
        .arg(&script)
        .spawn()
        .map(|_| ())
        .map_err(|e| CommandError::Io(e.to_string()))
}

#[cfg(not(target_os = "macos"))]
fn spawn_terminal_running(argv: &[String]) -> Result<(), CommandError> {
    std::process::Command::new("x-terminal-emulator")
        .arg("-e")
        .args(argv)
        .spawn()
        .map(|_| ())
        .map_err(|e| CommandError::Io(e.to_string()))
}

#[cfg(test)]
mod remote {
    /// `CR_TEST_HOST=<host> CR_TEST_FACTORY=<factory> cargo test -- --ignored remote_checks --nocapture`
    /// — against a host and factory in the developer's config. Set
    /// `CR_TEST_FILE` (relative to the factory) to also fetch a file.
    #[test]
    #[ignore]
    fn remote_checks() {
        let host_name = std::env::var("CR_TEST_HOST").expect("CR_TEST_HOST");
        let factory = std::env::var("CR_TEST_FACTORY").expect("CR_TEST_FACTORY");
        let r = crate::resolve::resolve(&host_name, &factory).unwrap();
        tauri::async_runtime::block_on(async {
            let ssh = r.host.ssh.clone().unwrap_or_default();
            let h = super::test_host(ssh.clone(), r.host.node.clone()).await.unwrap();
            println!("pm2_found {} running {:?}", h.pm2_found, h.running);
            let bare = super::test_host(ssh, None).await.unwrap();
            println!("without node: pm2_found {}", bare.pm2_found);
            if let Ok(file) = std::env::var("CR_TEST_FILE") {
                let fetched = super::fetch_file(host_name.clone(), factory.clone(), file).await.unwrap();
                println!("fetched {}", fetched);
            }
            for p in [r.factory.path.as_str(), "~/nope", "~"] {
                let c = super::check_factory_path(host_name.clone(), p.into()).await.unwrap();
                println!("{:<45} exists {} main {:?} root {}", p, c.exists, c.main, c.root);
            }
        });
    }
}
