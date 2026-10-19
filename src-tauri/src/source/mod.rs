// Where a factory's data comes from. Every read of a factory's filesystem goes
// through a Source; the logic above it (monitor.rs, the commands) never
// touches a disk, so it runs unchanged against this machine or — via the
// bundled al-control probe over SSH — a remote host.
//
// The types are the probe's JSON shapes (al-control src/probe.js), so the
// local implementation and the remote probe are interchangeable.

pub mod local;
pub mod ssh;

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::central_config::{HostEntry, FactoryEntry};
use crate::commands::CommandError;
use crate::resolve::resolve;

/// A station def as the probe returns it: the raw JSON plus its `line`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawStationDef {
    pub line: Option<String>,
    pub data: serde_json::Value,
}

/// Probe `state`: station + line defs and, for every station on a line, each
/// bin's workpieces (id → path relative to the bin; `None` = no bin dir).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawState {
    pub root: String,
    pub stations: Vec<RawStationDef>,
    pub lines: serde_json::Map<String, serde_json::Value>,
    pub bins: HashMap<String, BTreeMap<String, Option<HashMap<String, String>>>>,
    /// Failed folders without `pointer.json`, per station (only stations
    /// with any): dir name → path relative to the failed bin.
    #[serde(default)]
    pub orphans: HashMap<String, HashMap<String, String>>,
    /// `.orchestrator/factory.json`, committed factory settings (`orchestrator_url`, `org`).
    #[serde(default)]
    pub factory: Option<serde_json::Value>,
}

/// Probe `counts`, one factory: per-bin workpiece counts (`None` = no bin
/// dir) and each station's line. `error` instead when the factory can't be read.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FactoryCounts {
    #[serde(default)]
    pub root: Option<String>,
    #[serde(default)]
    pub lines: HashMap<String, String>,
    #[serde(default)]
    pub counts: HashMap<String, BTreeMap<String, Option<u32>>>,
    /// Orphaned failed folders per station (not in `counts.failed`).
    #[serde(default)]
    pub orphans: HashMap<String, u32>,
    #[serde(default)]
    pub error: Option<String>,
}

/// Counts for every factory on a host — one probe round trip for a remote
/// host, a local scan per factory otherwise.
pub fn host_counts(host: &HostEntry) -> Result<HashMap<String, FactoryCounts>, CommandError> {
    if host.is_local {
        return Ok(host
            .factories
            .iter()
            .map(|w| {
                let root = PathBuf::from(w.abs_path.clone().unwrap_or_default());
                let c = local::read_counts(&root)
                    .unwrap_or_else(|e| FactoryCounts { error: Some(e.to_string()), ..Default::default() });
                (w.name.clone(), c)
            })
            .collect());
    }
    let paths: serde_json::Map<String, serde_json::Value> =
        host.factories.iter().map(|w| (w.name.clone(), serde_json::Value::from(w.path.clone()))).collect();
    from_probe(ssh::probe(host, serde_json::json!({ "type": "counts", "paths": paths }))?)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub size: u64,
}

/// Probe `workpiece`: every file under the folder, and its `error.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkpieceFiles {
    pub files: Vec<FileEntry>,
    pub error: Option<serde_json::Value>,
}

/// Probe `errors`, one dir: error.json without its stack, message capped.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ErrorSummary {
    pub failed_at: Option<String>,
    pub name: Option<String>,
    pub code: Option<serde_json::Value>,
    pub message: String,
}

impl ErrorSummary {
    /// The probe's summary of a parsed error.json: no stack, message capped
    /// at 2,000 chars.
    pub fn of(e: &serde_json::Value) -> ErrorSummary {
        let str_at = |k: &str| e.get(k).and_then(|v| v.as_str()).map(String::from);
        let message = match e.get("message") {
            None | Some(serde_json::Value::Null) => String::new(),
            Some(serde_json::Value::String(s)) => s.clone(),
            Some(other) => other.to_string(),
        };
        ErrorSummary {
            failed_at: str_at("failed_at"),
            name: str_at("name"),
            code: e.get("code").filter(|c| !c.is_null()).cloned(),
            message: message.chars().take(2000).collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct FileContent {
    pub content: String,
    pub size: u64,
    pub truncated: bool,
    /// A NUL byte in the first 8 KB — `content` is then empty.
    pub is_binary: bool,
}

pub enum Source {
    Local { root: PathBuf },
    /// `path` as written in the config; `~` is resolved on the host.
    Ssh { host: HostEntry, path: String },
}

impl Source {
    /// The source for a factory in the central config.
    pub fn for_factory(host: &str, factory: &str) -> Result<Source, CommandError> {
        let r = resolve(host, factory)?;
        Ok(Source::for_entry(&r.host, &r.factory))
    }

    pub fn for_entry(host: &HostEntry, factory: &FactoryEntry) -> Source {
        match &factory.abs_path {
            Some(p) if host.is_local => Source::Local { root: PathBuf::from(p) },
            _ => Source::Ssh { path: factory.path.clone(), host: host.clone() },
        }
    }

    fn probe(&self, query: serde_json::Value) -> Result<serde_json::Value, CommandError> {
        match self {
            Source::Ssh { host, .. } => ssh::probe(host, query),
            Source::Local { .. } => unreachable!("local sources read the disk directly"),
        }
    }

    pub fn is_local(&self) -> bool {
        matches!(self, Source::Local { .. })
    }

    pub fn state(&self) -> Result<RawState, CommandError> {
        match self {
            Source::Local { root } => local::read_state(root),
            Source::Ssh { path, .. } => from_probe(self.probe(serde_json::json!({ "type": "state", "path": path }))?),
        }
    }

    /// Parsed `log.jsonl` per workpiece dir (relative to temp/stations/),
    /// as raw event objects.
    pub fn logs(&self, dirs: &[String]) -> Result<HashMap<String, Vec<serde_json::Value>>, CommandError> {
        if dirs.is_empty() {
            return Ok(HashMap::new());
        }
        match self {
            Source::Local { root } => local::read_logs(root, dirs),
            Source::Ssh { path, .. } => {
                from_probe(self.probe(serde_json::json!({ "type": "logs", "path": path, "dirs": dirs }))?["logs"].take())
            }
        }
    }

    /// Last activity (ms since epoch) per workpiece dir: the later of the
    /// folder's and its log.jsonl's mtime; `None` if the dir is gone.
    pub fn ages(&self, dirs: &[String]) -> Result<HashMap<String, Option<u64>>, CommandError> {
        if dirs.is_empty() {
            return Ok(HashMap::new());
        }
        match self {
            Source::Local { root } => local::read_ages(root, dirs),
            Source::Ssh { path, .. } => {
                from_probe(self.probe(serde_json::json!({ "type": "ages", "path": path, "dirs": dirs }))?["ages"].take())
            }
        }
    }

    /// error.json summaries per dir; `None` where there's none.
    pub fn errors(&self, dirs: &[String]) -> Result<HashMap<String, Option<ErrorSummary>>, CommandError> {
        if dirs.is_empty() {
            return Ok(HashMap::new());
        }
        match self {
            Source::Local { root } => local::read_errors(root, dirs),
            Source::Ssh { path, .. } => {
                from_probe(self.probe(serde_json::json!({ "type": "errors", "path": path, "dirs": dirs }))?["errors"].take())
            }
        }
    }

    /// Delete workpiece dirs. The source re-checks every one and refuses the
    /// whole batch (`CommandError::Refused`) before deleting anything if one
    /// isn't a workpiece in a `done` / `output` bin, or is in `keep`.
    pub fn remove(&self, dirs: &[String], keep: &[String]) -> Result<usize, CommandError> {
        if dirs.is_empty() {
            return Ok(0);
        }
        match self {
            Source::Local { root } => local::remove_workpieces(root, dirs, keep),
            Source::Ssh { path, .. } => {
                let out = self.probe(serde_json::json!({ "type": "remove", "path": path, "dirs": dirs, "keep": keep }))?;
                Ok(out["removed"].as_array().map_or(0, |a| a.len()))
            }
        }
    }

    /// Move workpiece dirs back to their station's `input` for a retry. The
    /// source re-checks every one and refuses the whole batch before moving
    /// anything if one isn't a workpiece in a `failed` / `done` bin, or its
    /// `input/<id>` is taken.
    pub fn requeue(&self, dirs: &[String]) -> Result<usize, CommandError> {
        if dirs.is_empty() {
            return Ok(0);
        }
        match self {
            Source::Local { root } => local::requeue_workpieces(root, dirs),
            Source::Ssh { path, .. } => {
                let out = self.probe(serde_json::json!({ "type": "requeue", "path": path, "dirs": dirs }))?;
                Ok(out["requeued"].as_array().map_or(0, |a| a.len()))
            }
        }
    }

    pub fn workpiece(&self, dir: &str) -> Result<WorkpieceFiles, CommandError> {
        match self {
            Source::Local { root } => local::read_workpiece(root, dir),
            Source::Ssh { path, .. } => from_probe(self.probe(serde_json::json!({ "type": "workpiece", "path": path, "dir": dir }))?),
        }
    }

    /// A file in the factory repo, by path relative to its root.
    pub fn read_file(&self, file_path: &str) -> Result<FileContent, CommandError> {
        match self {
            Source::Local { root } => local::read_file(root, file_path),
            Source::Ssh { path, .. } => {
                // The probe reads inside temp/stations/ only, given a dir and a
                // file in it: `temp/stations/S/B/rest` → dir `S/B`, file `rest`.
                let rel = file_path.strip_prefix("temp/stations/").ok_or_else(|| {
                    CommandError::Io(format!("Only workpiece files can be read on a remote host: {}", file_path))
                })?;
                let mut parts = rel.splitn(3, '/');
                let (Some(station), Some(bin), Some(file)) = (parts.next(), parts.next(), parts.next()) else {
                    return Err(CommandError::Io(format!("Not a workpiece file: {}", file_path)));
                };
                let data = self.probe(serde_json::json!({
                    "type": "read", "path": path, "dir": format!("{}/{}", station, bin), "file": file
                }))?;
                Ok(file_content_from_probe(&data))
            }
        }
    }

    /// The factory's `.env` (used for orchestrator links).
    pub fn env(&self) -> Result<HashMap<String, String>, CommandError> {
        match self {
            Source::Local { root } => local::read_env(root),
            // The probe deliberately doesn't read a factory's environment.
            Source::Ssh { .. } => Ok(HashMap::new()),
        }
    }
}

fn from_probe<T: serde::de::DeserializeOwned>(v: serde_json::Value) -> Result<T, CommandError> {
    serde_json::from_value(v).map_err(|e| CommandError::Json(format!("unexpected probe result: {}", e)))
}

/// Probe `read` → FileContent, capped like a local read.
fn file_content_from_probe(data: &serde_json::Value) -> FileContent {
    const CAP: usize = 1_048_576;
    let content = data["content"].as_str().unwrap_or_default();
    if data["encoding"] == "base64" {
        // base64 is 4 chars per 3 bytes
        return FileContent { content: String::new(), size: (content.len() * 3 / 4) as u64, truncated: false, is_binary: true };
    }
    let size = content.len() as u64;
    let mut end = content.len().min(CAP);
    while !content.is_char_boundary(end) {
        end -= 1;
    }
    FileContent { content: content[..end].to_string(), size, truncated: end < content.len(), is_binary: false }
}

#[cfg(test)]
mod remote {
    use super::*;

    /// `cargo test -- --ignored remote_source --nocapture` — every factory on
    /// every remote host in the developer's config, through the SSH source.
    #[test]
    #[ignore]
    fn remote_source_reads_every_remote_factory() {
        let cfg = crate::central_config::load().unwrap().expect("config");
        for h in cfg.hosts.iter().filter(|h| !h.is_local) {
            for w in &h.factories {
                let started = std::time::Instant::now();
                let src = Source::for_factory(&h.name, &w.name).unwrap();
                let state = src.state().unwrap();
                let lines = crate::monitor::build_lines(&state);
                let failed: Vec<String> = state
                    .bins
                    .iter()
                    .flat_map(|(st, b)| b.get("failed").and_then(|l| l.as_ref()).map(|l| l.values().map(|sub| format!("{}/failed/{}", st, sub)).collect::<Vec<_>>()).unwrap_or_default())
                    .collect();
                let logs = src.logs(&failed).unwrap();
                println!(
                    "{}/{:<16} root {}  {} lines  {} failed ({} logs)  {:?}",
                    h.name, w.name, state.root, lines.len(), failed.len(), logs.len(), started.elapsed()
                );
                if let Some(first) = failed.first() {
                    let wp = src.workpiece(first).unwrap();
                    println!("    {}: {} files, error: {}", first, wp.files.len(), wp.error.is_some());
                    let file = src.read_file(&format!("temp/stations/{}/{}", first, wp.files[0].name)).unwrap();
                    println!("    read {} → {} bytes, binary {}", wp.files[0].name, file.size, file.is_binary);
                }
            }
        }
    }
}

#[cfg(test)]
mod soak {
    use super::*;

    fn rss_mb() -> u64 {
        let out = std::process::Command::new("ps").args(["-o", "rss=", "-p", &std::process::id().to_string()]).output().unwrap();
        String::from_utf8_lossy(&out.stdout).trim().parse::<u64>().unwrap_or(0) / 1024
    }

    /// `CR_TEST_HOST=<host> CR_TEST_FACTORY=<factory> cargo test --release -- --ignored soak --nocapture`
    /// — repeated remote reads; RSS should stay flat.
    #[test]
    #[ignore]
    fn soak_remote_reads() {
        let host = std::env::var("CR_TEST_HOST").expect("CR_TEST_HOST");
        let factory = std::env::var("CR_TEST_FACTORY").expect("CR_TEST_FACTORY");
        let src = Source::for_factory(&host, &factory).unwrap();
        for i in 0..40 {
            let s = src.state().unwrap();
            let lines = crate::monitor::build_lines(&s);
            if i % 5 == 0 {
                println!("state #{:<3} {} lines  rss {} MB", i, lines.len(), rss_mb());
            }
        }
        for i in 0..60 {
            tauri::async_runtime::block_on(crate::pm2::factory_status(host.clone(), factory.clone())).unwrap();
            if i % 10 == 0 {
                println!("status #{:<3} rss {} MB", i, rss_mb());
            }
        }
        println!("end rss {} MB", rss_mb());
    }
}

#[cfg(test)]
mod counts_timing {
    /// `cargo test -- --ignored counts_timing --nocapture` — what one rail
    /// tick costs on each host in the developer's config.
    #[test]
    #[ignore]
    fn counts_timing() {
        let cfg = crate::central_config::load().unwrap().expect("config");
        for h in &cfg.hosts {
            for _ in 0..3 {
                let t = std::time::Instant::now();
                let c = super::host_counts(h).unwrap();
                let failed: u32 = c.values().flat_map(|w| w.counts.values()).filter_map(|b| b.get("failed").copied().flatten()).sum();
                println!("{:<14} {} factories  {:>4} failed  {:?}", h.name, c.len(), failed, t.elapsed());
            }
        }
    }
}
