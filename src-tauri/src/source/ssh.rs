// A remote host's factories, via al-control's probe piped over the system
// `ssh` — the same call as al-control's src/transport.js, so the host needs
// only node (and pm2), nothing installed:
//
//   ssh -o BatchMode=yes -o ControlMaster=auto -o ControlPath=~/.assemblyline/al-control/ssh-%C
//       -o ControlPersist=10m -- <alias> '<PATH=dir(node):$PATH> <node> --input-type=module -'
//   stdin  = probe.js + `main(<query JSON>);`
//   stdout = one {ok, data} | {ok: false, error: {code, message}} envelope
//
// The ControlPath is the CLI's, so the app and a terminal share one
// connection per host: whichever signs in first, the other rides along.
//
// There's no terminal to show ssh's stderr on, and Tailscale SSH's check
// mode prints a login URL there and waits. So stderr is streamed line by
// line as `ssh-stderr` events and each call reports `ssh-call` start/end —
// the UI turns those into a sign-in banner and a connection dot.

use std::io::{BufRead, Read, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::central_config::{home_dir, HostEntry};
use crate::commands::CommandError;
use crate::events;

/// al-control's src/probe.js, copied verbatim (from al-control accfef4).
/// Re-copy deliberately when the probe changes; the test below checks every
/// query Rust sends exists in it.
pub const PROBE_SOURCE: &str = include_str!("../../resources/probe.js");

/// Covers a Tailscale sign-in in the browser; then the call fails.
const CALL_TIMEOUT: Duration = Duration::from_secs(120);

/// POSIX single-quote for the remote shell.
pub fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// ssh argv up to and including the destination. Same options as the CLI;
/// sockets always under ~/.assemblyline/al-control (unix socket paths cap at 104
/// bytes; `%C` is 40 hex chars) — skip multiplexing if even that's too long.
pub fn ssh_args(host: &HostEntry, tty: bool) -> Vec<String> {
    let socket_dir = home_dir().join(".assemblyline").join("al-control");
    let control_path = socket_dir.join("ssh-%C").display().to_string();
    let multiplex = control_path.len() - 2 + 40 < 104;
    if multiplex {
        let _ = std::fs::create_dir_all(&socket_dir);
    }
    let mut args: Vec<String> = vec!["-o".into(), "BatchMode=yes".into()];
    if multiplex {
        for o in ["ControlMaster=auto".to_string(), format!("ControlPath={}", control_path), "ControlPersist=10m".into()] {
            args.push("-o".into());
            args.push(o);
        }
    }
    if tty {
        args.push("-t".into());
    }
    args.push("--".into());
    args.push(host.ssh.clone().unwrap_or_default());
    args
}

/// `PATH=<dir of node>:$PATH ` when the host sets `node:` — non-interactive
/// SSH shells skip .bashrc, so nvm's node and pm2 are otherwise off PATH.
pub fn env_prefix(host: &HostEntry) -> String {
    match &host.node {
        Some(node) => {
            let dir = std::path::Path::new(node).parent().map(|p| p.display().to_string()).unwrap_or_default();
            format!("PATH={}:\"$PATH\" ", shell_quote(&dir))
        }
        None => String::new(),
    }
}

#[derive(Clone, Serialize)]
struct SshCall<'a> {
    host: &'a str,
    phase: &'a str,
    message: Option<String>,
}

/// Run a remote command with `input` on stdin, streaming stderr as events,
/// with a timeout. Returns (exit code, stdout, stderr lines).
pub fn run(host: &HostEntry, remote_cmd: &str, input: &str) -> Result<(i32, Vec<u8>, Vec<String>), CommandError> {
    let mut child = Command::new("ssh")
        .args(ssh_args(host, false))
        .arg(remote_cmd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| CommandError::Ssh(format!("Could not run ssh: {}", e)))?;

    // stdin on its own thread: ssh may not read it until auth completes.
    let mut stdin = child.stdin.take().unwrap();
    let input = input.to_string();
    std::thread::spawn(move || {
        let _ = stdin.write_all(input.as_bytes()); // EPIPE = ssh already exited; its stderr says why
    });

    let mut stdout = child.stdout.take().unwrap();
    let (out_tx, out_rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        let _ = out_tx.send(buf);
    });

    let stderr = child.stderr.take().unwrap();
    let (err_tx, err_rx) = mpsc::channel();
    let host_name = host.name.clone();
    std::thread::spawn(move || {
        let mut lines = Vec::new();
        for line in std::io::BufReader::new(stderr).lines().map_while(Result::ok) {
            events::emit("ssh-stderr", serde_json::json!({ "host": host_name, "line": line }));
            lines.push(line);
        }
        let _ = err_tx.send(lines);
    });

    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| CommandError::Ssh(e.to_string()))? {
            break status;
        }
        if started.elapsed() > CALL_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(CommandError::Ssh(format!(
                "{} didn't answer within {}s (waiting on sign-in?)",
                host.name,
                CALL_TIMEOUT.as_secs()
            )));
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    let out = out_rx.recv().unwrap_or_default();
    let err = err_rx.recv().unwrap_or_default();
    Ok((status.code().unwrap_or(-1), out, err))
}

/// Run one probe query on the host and return its `data`. Emits `ssh-call`
/// start / ok / error so the UI can show the connection state.
pub fn probe(host: &HostEntry, query: serde_json::Value) -> Result<serde_json::Value, CommandError> {
    events::emit("ssh-call", SshCall { host: &host.name, phase: "start", message: None });
    let result = probe_inner(host, &query);
    let (phase, message) = match &result {
        Ok(_) => ("ok", None),
        Err(e) => ("error", Some(e.to_string())),
    };
    events::emit("ssh-call", SshCall { host: &host.name, phase, message });
    result
}

fn probe_inner(host: &HostEntry, query: &serde_json::Value) -> Result<serde_json::Value, CommandError> {
    let node = host.node.as_deref().map(shell_quote).unwrap_or_else(|| "node".into());
    let remote_cmd = format!("{}{} --input-type=module -", env_prefix(host), node);
    // The query rides in the script, not argv: Linux caps one argument at 128 KB.
    let input = format!("{}\nmain({});\n", PROBE_SOURCE, query);
    let (code, out, err) = run(host, &remote_cmd, &input)?;

    if code == 255 {
        return Err(CommandError::Ssh(format!(
            "ssh to {} ({}) failed: {}",
            host.name,
            host.ssh.as_deref().unwrap_or(""),
            last_lines(&err)
        )));
    }
    if code == 127 {
        return Err(CommandError::Ssh(format!(
            "node not found on {}. Set 'node:' for this host in the config to its absolute path (`which node` in an interactive shell there).",
            host.name
        )));
    }
    let envelope: serde_json::Value = serde_json::from_slice(&out).map_err(|_| {
        CommandError::Ssh(format!(
            "Unexpected output from {} (exit {}): {}{}",
            host.name,
            code,
            String::from_utf8_lossy(&out).chars().take(500).collect::<String>(),
            last_lines(&err)
        ))
    })?;
    if envelope["ok"] == true {
        return Ok(envelope["data"].clone());
    }
    let code = envelope["error"]["code"].as_str().unwrap_or("PROBE_ERROR");
    let message = format!("{}: {}", host.name, envelope["error"]["message"].as_str().unwrap_or("probe failed"));
    Err(if code == "REFUSED" { CommandError::Refused(message) } else { CommandError::Io(message) })
}

fn last_lines(err: &[String]) -> String {
    let tail: Vec<&str> = err.iter().rev().take(3).rev().map(|s| s.as_str()).collect();
    tail.join(" / ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host(node: Option<&str>) -> HostEntry {
        HostEntry { name: "prod".into(), is_local: false, ssh: Some("prod-box".into()), node: node.map(String::from), factories: vec![] }
    }

    #[test]
    fn quoting_and_env_prefix() {
        assert_eq!(shell_quote("it's"), r"'it'\''s'");
        assert_eq!(env_prefix(&host(None)), "");
        assert_eq!(env_prefix(&host(Some("/home/a/.nvm/v22/bin/node"))), "PATH='/home/a/.nvm/v22/bin':\"$PATH\" ");
    }

    #[test]
    fn ssh_args_end_with_the_alias_after_double_dash() {
        let args = ssh_args(&host(None), true);
        assert_eq!(&args[..2], ["-o", "BatchMode=yes"]);
        assert!(args.contains(&"-t".to_string()));
        assert_eq!(&args[args.len() - 2..], ["--", "prod-box"]);
    }

    #[test]
    fn bundled_probe_has_every_query_rust_sends() {
        for q in ["state", "counts", "logs", "errors", "workpiece", "read", "remove", "requeue", "procs", "factories"] {
            assert!(PROBE_SOURCE.contains(&format!("case '{}'", q)), "probe.js lacks '{}'", q);
        }
        assert!(PROBE_SOURCE.contains("export function main(query)"));
    }

    /// The probe as the remote runs it — `node -` with the query appended —
    /// against a local fixture, with no ssh in between.
    #[test]
    fn probe_script_runs_under_node() {
        if Command::new("node").arg("--version").output().is_err() {
            return;
        }
        let root = crate::source::local::tests::make_factory();
        let query = serde_json::json!({ "type": "state", "path": root });
        let mut child = Command::new("node")
            .args(["--input-type=module", "-"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(format!("{}\nmain({});\n", PROBE_SOURCE, query).as_bytes()).unwrap();
        let out = child.wait_with_output().unwrap();
        let envelope: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
        assert_eq!(envelope["ok"], true);
        let theirs: crate::source::RawState = serde_json::from_value(envelope["data"].clone()).unwrap();
        assert_eq!(theirs.bins, crate::source::local::read_state(&root).unwrap().bins);
    }
}
