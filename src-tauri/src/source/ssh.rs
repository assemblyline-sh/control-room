// The system `ssh`, for the probe on a remote host (source/probe.rs), pm2 and
// the terminal — the same call as al-control's src/transport.js, so the host
// needs only node (and pm2), nothing installed:
//
//   ssh -o BatchMode=yes -o ControlMaster=auto -o ControlPath=~/.assemblyline/al-control/ssh-%C
//       -o ControlPersist=10m -- <alias> '<PATH=dir(node):$PATH> <command>'
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

use crate::central_config::{home_dir, HostEntry};
use crate::commands::CommandError;
use crate::events;

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

pub fn last_lines(err: &[String]) -> String {
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
}
