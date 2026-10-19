// al-control's probe, run for every host (al-control decision 0006): this
// machine's `node`, or the host's over the system `ssh` (source/ssh.rs).
//
//   stdin  = probe.js + `main(<query 1>);` [+ `\n` + `main(<query 2>);` …]
//   stdout = one {ok, data} | {ok: false, error: {code, message}} envelope per
//            query, newline-separated (JSON.stringify never emits a raw newline)
//
// Several queries in one script cost one node start, and one round trip on a
// remote host.

use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use serde::Serialize;

use super::ssh;
use crate::central_config::HostEntry;
use crate::commands::CommandError;
use crate::events;

/// al-control's src/probe.js, byte for byte, at the version pinned in
/// package.json (`npm run check:probe`). Never edit it here.
pub const PROBE_SOURCE: &str = include_str!("../../resources/probe.js");

#[derive(Clone, Serialize)]
struct SshCall<'a> {
    host: &'a str,
    phase: &'a str,
    message: Option<String>,
}

/// Run one query on the host and return its `data`.
pub fn probe(host: &HostEntry, query: serde_json::Value) -> Result<serde_json::Value, CommandError> {
    Ok(probe_all(host, &[query])?.remove(0))
}

/// Run several queries in one probe run; each result in order, or the first
/// error. A remote host's run reports `ssh-call` start / ok / error so the UI
/// can show the connection state.
pub fn probe_all(host: &HostEntry, queries: &[serde_json::Value]) -> Result<Vec<serde_json::Value>, CommandError> {
    if host.is_local {
        return run_local(host, queries);
    }
    events::emit("ssh-call", SshCall { host: &host.name, phase: "start", message: None });
    let result = run_remote(host, queries);
    let (phase, message) = match &result {
        Ok(_) => ("ok", None),
        Err(e) => ("error", Some(e.to_string())),
    };
    events::emit("ssh-call", SshCall { host: &host.name, phase, message });
    result
}

fn script(queries: &[serde_json::Value]) -> String {
    // The queries ride in the script, not argv: Linux caps one argument at 128 KB.
    let calls: Vec<String> = queries.iter().map(|q| format!("main({});", q)).collect();
    format!("{}\n{}\n", PROBE_SOURCE, calls.join("process.stdout.write('\\n');"))
}

fn run_local(host: &HostEntry, queries: &[serde_json::Value]) -> Result<Vec<serde_json::Value>, CommandError> {
    let node = local_node(host);
    let mut child = with_node_path(Command::new(&node), &node)
        .args(["--input-type=module", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            CommandError::Io(format!(
                "Could not run node ({}): {}. Set 'node:' for the local host in the config to its absolute path.",
                node, e
            ))
        })?;
    let input = script(queries);
    let mut stdin = child.stdin.take().unwrap();
    // On its own thread: a large script can fill the pipe before node reads it.
    let writer = std::thread::spawn(move || stdin.write_all(input.as_bytes()));
    let out = child.wait_with_output().map_err(|e| CommandError::Io(e.to_string()))?;
    let _ = writer.join();
    let stderr = String::from_utf8_lossy(&out.stderr);
    envelopes("local", &out.stdout, queries.len(), stderr.lines().last().unwrap_or(""))
}

fn run_remote(host: &HostEntry, queries: &[serde_json::Value]) -> Result<Vec<serde_json::Value>, CommandError> {
    let node = host.node.as_deref().map(ssh::shell_quote).unwrap_or_else(|| "node".into());
    let remote_cmd = format!("{}{} --input-type=module -", ssh::env_prefix(host), node);
    let (code, out, err) = ssh::run(host, &remote_cmd, &script(queries))?;
    if code == 255 {
        return Err(CommandError::Ssh(format!(
            "ssh to {} ({}) failed: {}",
            host.name,
            host.ssh.as_deref().unwrap_or(""),
            ssh::last_lines(&err)
        )));
    }
    if code == 127 {
        return Err(CommandError::Ssh(format!(
            "node not found on {}. Set 'node:' for this host in the config to its absolute path (`which node` in an interactive shell there).",
            host.name
        )));
    }
    envelopes(&host.name, &out, queries.len(), &ssh::last_lines(&err))
}

/// Split stdout into one envelope per query and unwrap each.
fn envelopes(host: &str, out: &[u8], expected: usize, stderr_tail: &str) -> Result<Vec<serde_json::Value>, CommandError> {
    let text = String::from_utf8_lossy(out);
    let parsed: Vec<serde_json::Value> = text.split('\n').filter_map(|l| serde_json::from_str(l).ok()).collect();
    if parsed.len() != expected {
        return Err(CommandError::Io(format!(
            "Unexpected output from the probe on {}: {}{}",
            host,
            text.chars().take(500).collect::<String>(),
            stderr_tail
        )));
    }
    parsed
        .into_iter()
        .map(|envelope| {
            if envelope["ok"] == true {
                return Ok(envelope["data"].clone());
            }
            let code = envelope["error"]["code"].as_str().unwrap_or("PROBE_ERROR");
            let message = format!("{}: {}", host, envelope["error"]["message"].as_str().unwrap_or("probe failed"));
            Err(if code == "REFUSED" { CommandError::Refused(message) } else { CommandError::Io(message) })
        })
        .collect()
}

/// `node` for this machine: the local host's `node:` when set, else the one
/// the user's login shell finds (an app opened from the Finder gets a bare
/// PATH, without nvm's or Homebrew's bin), else whatever `node` is on PATH.
pub fn local_node(host: &HostEntry) -> String {
    if let Some(node) = host.node.as_deref().filter(|n| !n.is_empty()) {
        return crate::central_config::expand_tilde(node).display().to_string();
    }
    static FOUND: OnceLock<String> = OnceLock::new();
    FOUND.get_or_init(|| login_shell_node().unwrap_or_else(|| "node".into())).clone()
}

fn login_shell_node() -> Option<String> {
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty())?;
    let out = Command::new(shell).args(["-ilc", "command -v node"]).stdin(Stdio::null()).output().ok()?;
    // An interactive shell may print a banner first; the path is the last line.
    String::from_utf8_lossy(&out.stdout).lines().rev().map(str::trim).find(|l| l.starts_with('/')).map(String::from)
}

/// Put `node`'s own directory first on PATH, so the probe's `pm2 jlist` and a
/// local `pm2` find the pm2 installed alongside it.
pub fn with_node_path(mut cmd: Command, node: &str) -> Command {
    if let Some(dir) = std::path::Path::new(node).parent().filter(|d| !d.as_os_str().is_empty()) {
        let path = std::env::var_os("PATH").unwrap_or_default();
        let mut dirs = vec![dir.to_path_buf()];
        dirs.extend(std::env::split_paths(&path));
        if let Ok(joined) = std::env::join_paths(dirs) {
            cmd.env("PATH", joined);
        }
    }
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local() -> HostEntry {
        HostEntry { name: "local".into(), is_local: true, ssh: None, node: None, factories: vec![] }
    }

    #[test]
    fn bundled_probe_has_every_query_rust_sends() {
        for q in ["state", "lines", "counts", "logs", "errors", "ages", "workpiece", "read", "remove", "requeue", "procs", "factories"] {
            assert!(PROBE_SOURCE.contains(&format!("case '{}'", q)), "probe.js lacks '{}'", q);
        }
        assert!(PROBE_SOURCE.contains("export function main(query)"));
    }

    #[test]
    fn several_queries_come_back_in_order_from_one_run() {
        let root = super::super::fixtures::make_factory();
        let path = root.display().to_string();
        let out = probe_all(
            &local(),
            &[serde_json::json!({ "type": "lines", "path": path }), serde_json::json!({ "type": "state", "path": path })],
        )
        .unwrap();
        assert_eq!(out[0]["lines"]["VM"]["stations"], serde_json::json!(["VM1", "VM2"]));
        assert_eq!(out[0]["lines"]["VM"]["terminal"], "VM2");
        assert!(out[1]["bins"]["VM1"]["output"]["wp-1"].is_string());
    }

    #[test]
    fn a_probe_error_comes_back_as_an_error() {
        let err = probe(&local(), serde_json::json!({ "type": "state", "path": "/nope/not/here" })).unwrap_err();
        assert!(err.to_string().contains("does not exist"), "{}", err);
        let err = probe(&local(), serde_json::json!({ "type": "remove", "path": "/tmp", "dirs": ["../x"], "keep": [] })).unwrap_err();
        assert!(matches!(err, CommandError::Refused(_)), "{:?}", err);
    }
}
