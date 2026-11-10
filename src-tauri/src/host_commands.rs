// Commands about hosts rather than one factory's data: checking a host or a
// factory path before it goes into the config, and opening a terminal at a
// factory or workpiece folder (a local Terminal, or one running `ssh -t`).

use serde::Serialize;

use crate::central_config::{HostEntry, LOCAL_HOST};
use crate::commands::CommandError;
use crate::resolve::resolve;
use std::path::{Component, Path, PathBuf};
use crate::source::{probe, ssh};

#[derive(Serialize)]
pub struct RunningFactory {
    /// Directory name, the name a new factory gets by default.
    pub name: String,
    /// Its folder on the host.
    pub path: String,
}

#[derive(Serialize)]
pub struct HostCheck {
    /// pm2 answered — start/stop/logs will work.
    pub pm2_found: bool,
    pub running: Vec<RunningFactory>,
}

/// A host for an alias not (yet) in the config.
fn remote_host(ssh: String, node: Option<String>) -> Result<HostEntry, CommandError> {
    if ssh.is_empty() || ssh.starts_with('-') {
        return Err(CommandError::Config(format!("Invalid ssh alias '{}'.", ssh)));
    }
    Ok(HostEntry { name: ssh.clone(), is_local: false, ssh: Some(ssh), node: node.filter(|n| !n.is_empty()), factories: vec![] })
}

/// A host from the config. `local` works before there is one: a new user's
/// first look at this machine.
fn configured_host(name: &str) -> Result<HostEntry, CommandError> {
    let found = crate::central_config::load()?.and_then(|cfg| cfg.hosts.into_iter().find(|h| h.name == name));
    match found {
        Some(h) => Ok(h),
        None if name == LOCAL_HOST => {
            Ok(HostEntry { name: name.into(), is_local: true, ssh: None, node: None, factories: vec![] })
        }
        None => Err(CommandError::Config(format!("No host named '{}'.", name))),
    }
}

/// One probe round trip: is pm2 there, and what's running?
fn check_host(host: &HostEntry) -> Result<HostCheck, CommandError> {
    let data = probe::probe(host, serde_json::json!({ "type": "factories", "paths": {} }))?;
    Ok(HostCheck {
        pm2_found: data["pm2_found"] == true,
        running: data["procs"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|p| Some(RunningFactory { name: p["factory"].as_str()?.into(), path: p["cwd"].as_str()?.into() }))
                    .collect()
            })
            .unwrap_or_default(),
    })
}

/// An alias not (yet) in the config.
#[tauri::command]
pub async fn test_host(ssh: String, node: Option<String>) -> Result<HostCheck, CommandError> {
    check_host(&remote_host(ssh, node)?)
}

/// A host in the config, or `local`.
#[tauri::command]
pub async fn running_factories(host: String) -> Result<HostCheck, CommandError> {
    check_host(&configured_host(&host)?)
}

/// Every `node` a host offers. Run with `sh -s`, so it doesn't depend on the
/// user's shell. Over plain ssh a host often finds the wrong `node`, or none:
/// nvm loads from .bashrc and Homebrew from .zprofile, so the user's own
/// shell is asked too. That shell gets /dev/null, or it reads this script.
const DETECT_NODE: &str = r#"report() {
  [ -f "$2" ] && [ -x "$2" ] || return 0
  version=$("$2" --version 2>/dev/null) || return 0
  pm2=no
  [ -e "$(dirname "$2")/pm2" ] && pm2=yes
  printf 'AL_NODE\t%s\t%s\t%s\t%s\n' "$1" "$2" "$version" "$pm2"
}
report plain "$(command -v node 2>/dev/null)"
report shell "$("${SHELL:-/bin/sh}" -ilc 'printf "AL_PATH:%s\n" "$(command -v node)"' </dev/null 2>/dev/null | sed -n 's/^.*AL_PATH://p' | tail -n 1)"
for node in "$HOME"/.nvm/versions/node/*/bin/node; do report nvm "$node"; done
exit 0
"#;

#[derive(Serialize, Debug, PartialEq)]
pub struct NodeCandidate {
    pub path: String,
    pub version: String,
    /// pm2 sits beside it, so this is the `node` pm2 was installed with.
    pub pm2: bool,
    /// Plain ssh finds this one, so the host needs no `node:` in the config.
    pub plain: bool,
    #[serde(skip)]
    shell: bool,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct NodeDetection {
    /// Best first.
    pub candidates: Vec<NodeCandidate>,
    /// More than one could be right, so the user picks.
    pub ask: bool,
}

/// `AL_NODE` lines to candidates: one per path, those with pm2 first, then the
/// one the user's shell finds, then plain ssh's, then the newest.
fn parse_node_candidates(out: &str) -> NodeDetection {
    let mut candidates: Vec<NodeCandidate> = vec![];
    for line in out.lines() {
        let f: Vec<&str> = line.split('\t').collect();
        let [marker, source, path, version, pm2] = f[..] else { continue };
        if marker != "AL_NODE" {
            continue;
        }
        let i = candidates.iter().position(|c| c.path == path).unwrap_or_else(|| {
            candidates.push(NodeCandidate { path: path.into(), version: version.into(), pm2: pm2 == "yes", plain: false, shell: false });
            candidates.len() - 1
        });
        candidates[i].plain |= source == "plain";
        candidates[i].shell |= source == "shell";
    }
    candidates.sort_by_key(|c| {
        let version: Vec<u32> = c.version.trim_start_matches('v').split('.').filter_map(|n| n.parse().ok()).collect();
        (!c.pm2, !c.shell, !c.plain, std::cmp::Reverse(version))
    });
    let with_pm2 = candidates.iter().filter(|c| c.pm2).count();
    let ask = candidates.len() > 1 && with_pm2 != 1;
    NodeDetection { candidates, ask }
}

/// Which `node` to use on an ssh alias not (yet) in the config.
#[tauri::command]
pub async fn detect_node(ssh: String) -> Result<NodeDetection, CommandError> {
    let host = remote_host(ssh, None)?;
    probe::reported(&host, || {
        let (code, out, err) = ssh::run(&host, "sh -s", DETECT_NODE)?;
        if code == 255 {
            return Err(probe::ssh_failed(&host, &err));
        }
        Ok(parse_node_candidates(&String::from_utf8_lossy(&out)))
    })
}

/// `Host` names in ssh config text, in order. Patterns aren't places to
/// connect to, so they're left out.
fn parse_ssh_hosts(config: &str) -> Vec<String> {
    let mut hosts: Vec<String> = vec![];
    for line in config.lines() {
        let line = line.trim();
        let Some((keyword, rest)) = line.split_once(|c: char| c.is_whitespace() || c == '=') else { continue };
        if !keyword.eq_ignore_ascii_case("host") {
            continue;
        }
        for name in rest.trim_start_matches(|c: char| c.is_whitespace() || c == '=').split_whitespace() {
            let name = name.trim_matches('"');
            if name.starts_with('#') {
                break;
            }
            if !name.contains(['*', '?', '!']) && !hosts.iter().any(|h| h == name) {
                hosts.push(name.to_string());
            }
        }
    }
    hosts
}

/// The computers in this user's ssh config, to choose from.
#[tauri::command]
pub async fn list_ssh_hosts() -> Vec<String> {
    let file = crate::central_config::home_dir().join(".ssh").join("config");
    parse_ssh_hosts(&std::fs::read_to_string(file).unwrap_or_default())
}

#[derive(Serialize)]
pub struct PathCheck {
    pub exists: bool,
    /// package.json `main` when the dir is a factory (has @assemblyline/lib-factory).
    pub main: Option<String>,
    /// The path with `~` resolved on the host.
    pub root: String,
}

/// Before adding a factory: does the path exist there, and is it a factory?
#[tauri::command]
pub async fn check_factory_path(host: String, path: String) -> Result<PathCheck, CommandError> {
    path_check(&configured_host(&host)?, &path)
}

fn path_check(host: &HostEntry, path: &str) -> Result<PathCheck, CommandError> {
    let data = probe::probe(host, serde_json::json!({ "type": "factories", "paths": { "candidate": path } }))?;
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

    let data = probe::probe(&r.host, serde_json::json!({ "type": "factories", "paths": { factory: r.factory.path } }))?;
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
        let abs = lexical(&root.join(&file_path));
        if !abs.starts_with(lexical(&root)) {
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
    let data = probe::probe(
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

#[cfg(all(unix, not(target_os = "macos")))]
fn spawn_terminal_at(dir: &str) -> Result<(), CommandError> {
    std::process::Command::new("x-terminal-emulator")
        .current_dir(dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| CommandError::Io(e.to_string()))
}

/// PowerShell in a console of its own, which Windows 11 opens in the default
/// terminal app.
#[cfg(windows)]
fn spawn_terminal_at(dir: &str) -> Result<(), CommandError> {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("powershell.exe")
        .arg("-NoExit")
        .current_dir(dir)
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
        .map(|_| ())
        .map_err(|e| CommandError::Io(e.to_string()))
}

#[cfg(windows)]
const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

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

#[cfg(all(unix, not(target_os = "macos")))]
fn spawn_terminal_running(argv: &[String]) -> Result<(), CommandError> {
    std::process::Command::new("x-terminal-emulator")
        .arg("-e")
        .args(argv)
        .spawn()
        .map(|_| ())
        .map_err(|e| CommandError::Io(e.to_string()))
}

/// The argv itself in a console of its own: no shell, so nothing to quote.
#[cfg(windows)]
fn spawn_terminal_running(argv: &[String]) -> Result<(), CommandError> {
    use std::os::windows::process::CommandExt;
    std::process::Command::new(&argv[0])
        .args(&argv[1..])
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
        .map(|_| ())
        .map_err(|e| CommandError::Io(e.to_string()))
}

/// A dir given relative to temp/stations/, refusing anything that escapes it.
pub fn stations_path(root: &Path, rel: &str) -> Result<PathBuf, CommandError> {
    let stations_root = lexical(&root.join("temp").join("stations"));
    let abs = lexical(&stations_root.join(rel));
    if abs == stations_root || !abs.starts_with(&stations_root) {
        return Err(CommandError::Io(format!("Refusing to touch outside temp/stations/: {}", rel)));
    }
    Ok(abs)
}

/// Collapse `.` and `..` without touching the filesystem.
pub fn lexical(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in p.components() {
        match comp {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

#[cfg(test)]
mod detection {
    use super::*;

    fn paths(d: &NodeDetection) -> Vec<&str> {
        d.candidates.iter().map(|c| c.path.as_str()).collect()
    }

    /// What `alex-linux-pc` reports: plain ssh finds an old system node, and
    /// only the shell's nvm node has pm2.
    const NVM_HOST: &str = "AL_NODE\tplain\t/usr/bin/node\tv18.19.1\tno
AL_NODE\tshell\t/h/.nvm/versions/node/v22.21.0/bin/node\tv22.21.0\tyes
AL_NODE\tnvm\t/h/.nvm/versions/node/v20.19.6/bin/node\tv20.19.6\tno
AL_NODE\tnvm\t/h/.nvm/versions/node/v22.21.0/bin/node\tv22.21.0\tyes
AL_NODE\tnvm\t/h/.nvm/versions/node/v25.0.0/bin/node\tv25.0.0\tno
";

    #[test]
    fn the_only_node_with_pm2_wins_without_asking() {
        let d = parse_node_candidates(NVM_HOST);
        assert!(!d.ask);
        assert_eq!(paths(&d)[0], "/h/.nvm/versions/node/v22.21.0/bin/node");
        assert_eq!(d.candidates.len(), 4, "the shell and nvm reports are the same node");
        assert!(!d.candidates[0].plain);
    }

    #[test]
    fn several_with_pm2_are_a_choice_led_by_the_shells() {
        let d = parse_node_candidates(
            "AL_NODE\tnvm\t/n/20/node\tv20.1.0\tyes\nAL_NODE\tshell\t/n/18/node\tv18.1.0\tyes\nAL_NODE\tnvm\t/n/24/node\tv24.1.0\tno\n",
        );
        assert!(d.ask);
        assert_eq!(paths(&d), ["/n/18/node", "/n/20/node", "/n/24/node"]);
    }

    #[test]
    fn none_with_pm2_is_a_choice_led_by_the_newest_after_the_shells() {
        let d = parse_node_candidates("AL_NODE\tnvm\t/n/9/node\tv9.0.0\tno\nAL_NODE\tnvm\t/n/10/node\tv10.0.0\tno\n");
        assert!(d.ask);
        assert_eq!(paths(&d), ["/n/10/node", "/n/9/node"]);
    }

    #[test]
    fn one_node_is_no_choice_even_without_pm2() {
        let d = parse_node_candidates("AL_NODE\tplain\t/usr/bin/node\tv22.0.0\tno\nAL_NODE\tshell\t/usr/bin/node\tv22.0.0\tno\n");
        assert!(!d.ask);
        assert_eq!(d.candidates.len(), 1);
        assert!(d.candidates[0].plain);
    }

    #[test]
    fn no_node_and_shell_noise_give_nothing() {
        let d = parse_node_candidates("Welcome to Ubuntu\nlast login: today\n");
        assert_eq!(d, NodeDetection { candidates: vec![], ask: false });
    }

    /// The script itself, against a fake home: a node on PATH with no pm2,
    /// and an nvm one with pm2 that only the user's shell finds.
    #[cfg(unix)]
    #[test]
    fn the_script_finds_node_from_plain_ssh_the_shell_and_nvm() {
        use std::os::unix::fs::PermissionsExt;
        let home = std::env::temp_dir().join(format!("cr-detect-{}", std::process::id()));
        let fake = |dir: &Path, version: &str| {
            std::fs::create_dir_all(dir).unwrap();
            let node = dir.join("node");
            std::fs::write(&node, format!("#!/bin/sh\necho {}\n", version)).unwrap();
            std::fs::set_permissions(&node, std::fs::Permissions::from_mode(0o755)).unwrap();
        };
        let system = home.join("system");
        let nvm = home.join(".nvm/versions/node/v22.0.0/bin");
        fake(&system, "v18.0.0");
        fake(&nvm, "v22.0.0");
        std::fs::write(nvm.join("pm2"), "").unwrap();
        let shell = home.join("fakeshell");
        std::fs::write(&shell, format!("#!/bin/sh\necho 'a banner'\ncat >/dev/null\nPATH={}:$PATH exec /bin/sh -c \"$2\"\n", nvm.display())).unwrap();
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();

        let mut child = std::process::Command::new("/bin/sh")
            .args(["-s"])
            .env_clear()
            .env("HOME", &home)
            .env("SHELL", &shell)
            .env("PATH", format!("{}:/usr/bin:/bin", system.display()))
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        use std::io::Write;
        child.stdin.take().unwrap().write_all(DETECT_NODE.as_bytes()).unwrap();
        let out = child.wait_with_output().unwrap();
        let _ = std::fs::remove_dir_all(&home);

        let d = parse_node_candidates(&String::from_utf8_lossy(&out.stdout));
        assert!(!d.ask, "{:?}", d);
        assert_eq!(d.candidates.len(), 2, "{:?}", d);
        assert_eq!(d.candidates[0].version, "v22.0.0");
        assert!(d.candidates[0].pm2 && d.candidates[0].shell && !d.candidates[0].plain);
        assert!(d.candidates[1].plain && !d.candidates[1].pm2);
    }

    #[test]
    fn a_local_folder_is_checked_like_a_remote_one() {
        let local = HostEntry { name: LOCAL_HOST.into(), is_local: true, ssh: None, node: None, factories: vec![] };
        let dir = std::env::temp_dir().join(format!("cr-path-check-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.display().to_string();

        let plain = path_check(&local, &path).unwrap();
        assert!(plain.exists && plain.main.is_none());

        std::fs::write(dir.join("package.json"), r#"{"main":"src/index.js","dependencies":{"@assemblyline/lib-factory":"1"}}"#).unwrap();
        assert_eq!(path_check(&local, &path).unwrap().main.as_deref(), Some("src/index.js"));

        let _ = std::fs::remove_dir_all(&dir);
        assert!(!path_check(&local, &path).unwrap().exists);
    }

    #[test]
    fn ssh_hosts_are_the_named_ones_in_order() {
        let config = "# a comment
Host alex-linux-pc
  HostName 100.1.2.3
host  kiosk1 kiosk2 # two at once
Host=eq-host
Host \"quoted\"
Host *.internal !nope
Host *
  ForwardAgent no
Host alex-linux-pc
Match host x
HostName not-a-host
";
        assert_eq!(parse_ssh_hosts(config), ["alex-linux-pc", "kiosk1", "kiosk2", "eq-host", "quoted"]);
    }
}

#[cfg(test)]
mod remote {
    /// A newcomer's run, command by command, against a real host:
    /// `HOME=/tmp/cr CR_TEST_SSH=<alias> <test binary> --ignored first_run --nocapture`.
    /// Writes a config, so it refuses a real HOME.
    #[test]
    #[ignore]
    fn first_run_on_an_empty_home() {
        let home = crate::central_config::home_dir();
        assert!(home.starts_with("/tmp"), "HOME must be a scratch folder under /tmp, not {}", home.display());
        let ssh = std::env::var("CR_TEST_SSH").expect("CR_TEST_SSH");
        tauri::async_runtime::block_on(async {
            assert!(crate::commands::load_config().await.unwrap().is_none(), "HOME must start empty");
            println!("ssh hosts {:?}", super::list_ssh_hosts().await);
            let here = super::running_factories("local".into()).await.unwrap();
            println!("this computer: pm2 {} running {}", here.pm2_found, here.running.len());

            let found = super::detect_node(ssh.clone()).await.unwrap();
            let best = &found.candidates[0];
            println!("node {} {} pm2 {} plain {} ask {}", best.path, best.version, best.pm2, best.plain, found.ask);
            let node = (!best.plain).then(|| best.path.clone());

            let check = super::test_host(ssh.clone(), node.clone()).await.unwrap();
            assert!(check.pm2_found);
            crate::commands::add_host(ssh.clone(), ssh.clone(), node).await.unwrap();

            let running = super::running_factories(ssh.clone()).await.unwrap().running;
            let first = &running[0];
            let path = super::check_factory_path(ssh.clone(), first.path.clone()).await.unwrap();
            assert!(path.exists && path.main.is_some());
            let cfg = crate::commands::add_factory(ssh.clone(), None, first.path.clone()).await.unwrap();

            let host = cfg.hosts.iter().find(|h| h.name == ssh).unwrap();
            println!("saved {} node {:?} factories {:?}", host.name, host.node, host.factories.iter().map(|f| &f.path).collect::<Vec<_>>());
            assert_eq!(host.factories.len(), 1);
        });
    }

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
            println!("pm2_found {} running {:?}", h.pm2_found, h.running.iter().map(|r| format!("{} {}", r.name, r.path)).collect::<Vec<_>>());
            let bare = super::test_host(ssh.clone(), None).await.unwrap();
            println!("without node: pm2_found {}", bare.pm2_found);
            println!("{:#?}", super::detect_node(ssh).await.unwrap());
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
