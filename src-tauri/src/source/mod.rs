// Where a factory's data comes from. Every read of a factory's filesystem goes
// through a Source, which runs al-control's probe (source/probe.rs) on the
// factory's host: this machine's node, or the host's over SSH. The logic above
// it (monitor.rs, the commands) never touches a disk, and the types here are
// the probe's JSON shapes (al-control src/probe.js).

pub mod probe;
pub mod ssh;

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

use crate::central_config::{FactoryEntry, HostEntry};
use crate::monitor::LineState;
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

/// Counts for every factory on a host, in one probe run.
pub fn host_counts(host: &HostEntry) -> Result<HashMap<String, FactoryCounts>, CommandError> {
    let paths: serde_json::Map<String, serde_json::Value> =
        host.factories.iter().map(|w| (w.name.clone(), serde_json::Value::from(w.path.clone()))).collect();
    from_probe(probe::probe(host, serde_json::json!({ "type": "counts", "paths": paths }))?)
}

/// The probe's per-line summary (`summarizeCounts`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineSummary {
    pub in_flight: u32,
    pub stuck: u32,
    pub finished: u32,
    pub stuck_locations: Vec<String>,
    pub biggest_flow: BiggestFlow,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BiggestFlow {
    pub count: u32,
    pub at: Option<String>,
}

/// One line from the probe's `lines` query: stations in dependency order, the
/// terminal station, live bin counts per station (`None` = no bin dir) and the
/// summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeLine {
    pub code: String,
    pub name: Option<String>,
    pub stations: Vec<String>,
    #[serde(default)]
    pub terminal: Option<String>,
    pub counts: HashMap<String, BTreeMap<String, Option<u32>>>,
    pub summary: LineSummary,
}

/// Probe `defs`: station and line definitions from `.orchestrator/`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Defs {
    pub stations: Vec<RawStationDef>,
    pub lines: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub factory: Option<serde_json::Value>,
}

/// Probe `lines`: every line of a factory, counts only (no workpiece ids).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lines {
    pub root: String,
    pub lines: HashMap<String, ProbeLine>,
    /// `.orchestrator/factory.json` (`orchestrator_url`, `org`).
    #[serde(default)]
    pub factory: Option<serde_json::Value>,
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

/// One factory on one host. `path` is as written in the config; the probe
/// resolves `~` on the host.
pub struct Source {
    host: HostEntry,
    path: String,
}

impl Source {
    /// The source for a factory in the central config.
    pub fn for_factory(host: &str, factory: &str) -> Result<Source, CommandError> {
        let r = resolve(host, factory)?;
        Ok(Source::for_entry(&r.host, &r.factory))
    }

    pub fn for_entry(host: &HostEntry, factory: &FactoryEntry) -> Source {
        Source { host: host.clone(), path: factory.path.clone() }
    }

    fn query(&self, mut query: serde_json::Value) -> Result<serde_json::Value, CommandError> {
        query["path"] = self.path.clone().into();
        probe::probe(&self.host, query)
    }

    pub fn is_local(&self) -> bool {
        self.host.is_local
    }

    pub fn state(&self) -> Result<RawState, CommandError> {
        from_probe(self.query(serde_json::json!({ "type": "state" }))?)
    }

    pub fn defs(&self) -> Result<Defs, CommandError> {
        from_probe(self.query(serde_json::json!({ "type": "defs" }))?)
    }

    /// `lines` and `defs` (station and line definitions, no bin scan) from one
    /// probe run: what the line views need.
    pub fn lines_with_defs(&self) -> Result<(Lines, Defs), CommandError> {
        let mut out = probe::probe_all(
            &self.host,
            &[
                serde_json::json!({ "type": "lines", "path": self.path }),
                serde_json::json!({ "type": "defs", "path": self.path }),
            ],
        )?;
        let defs: Defs = from_probe(out.pop().unwrap())?;
        let lines: Lines = from_probe(out.pop().unwrap())?;
        Ok((lines, defs))
    }

    /// `state` and `lines` from one probe run, joined into line states with
    /// workpiece ids.
    pub fn floor(&self) -> Result<(RawState, HashMap<String, LineState>), CommandError> {
        let mut out = probe::probe_all(
            &self.host,
            &[
                serde_json::json!({ "type": "state", "path": self.path }),
                serde_json::json!({ "type": "lines", "path": self.path }),
            ],
        )?;
        let lines: Lines = from_probe(out.pop().unwrap())?;
        let state: RawState = from_probe(out.pop().unwrap())?;
        let joined = crate::monitor::join_lines(&state, &lines);
        Ok((state, joined))
    }

    /// Parsed `log.jsonl` per workpiece dir (relative to temp/stations/),
    /// as raw event objects.
    pub fn logs(&self, dirs: &[String]) -> Result<HashMap<String, Vec<serde_json::Value>>, CommandError> {
        if dirs.is_empty() {
            return Ok(HashMap::new());
        }
        from_probe(self.query(serde_json::json!({ "type": "logs", "dirs": dirs }))?["logs"].take())
    }

    /// Last activity (ms since epoch) per workpiece dir: the later of the
    /// folder's and its log.jsonl's mtime; `None` if the dir is gone.
    pub fn ages(&self, dirs: &[String]) -> Result<HashMap<String, Option<u64>>, CommandError> {
        if dirs.is_empty() {
            return Ok(HashMap::new());
        }
        from_probe(self.query(serde_json::json!({ "type": "ages", "dirs": dirs }))?["ages"].take())
    }

    /// error.json summaries per dir; `None` where there's none.
    pub fn errors(&self, dirs: &[String]) -> Result<HashMap<String, Option<ErrorSummary>>, CommandError> {
        if dirs.is_empty() {
            return Ok(HashMap::new());
        }
        from_probe(self.query(serde_json::json!({ "type": "errors", "dirs": dirs }))?["errors"].take())
    }

    /// Delete workpiece dirs. The probe re-checks every one and refuses the
    /// whole batch (`CommandError::Refused`) before deleting anything if one
    /// isn't a workpiece in a `done` / `output` bin, or is in `keep`.
    pub fn remove(&self, dirs: &[String], keep: &[String]) -> Result<usize, CommandError> {
        if dirs.is_empty() {
            return Ok(0);
        }
        let out = self.query(serde_json::json!({ "type": "remove", "dirs": dirs, "keep": keep }))?;
        Ok(out["removed"].as_array().map_or(0, |a| a.len()))
    }

    /// Move workpiece dirs back to their station's `input` for a retry. The
    /// probe re-checks every one and refuses the whole batch before moving
    /// anything if one isn't a workpiece in a `failed` / `done` bin, or its
    /// `input/<id>` is taken.
    pub fn requeue(&self, dirs: &[String]) -> Result<usize, CommandError> {
        if dirs.is_empty() {
            return Ok(0);
        }
        let out = self.query(serde_json::json!({ "type": "requeue", "dirs": dirs }))?;
        Ok(out["requeued"].as_array().map_or(0, |a| a.len()))
    }

    pub fn workpiece(&self, dir: &str) -> Result<WorkpieceFiles, CommandError> {
        from_probe(self.query(serde_json::json!({ "type": "workpiece", "dir": dir }))?)
    }

    /// A workpiece file, by path relative to the factory root. The probe reads
    /// inside temp/stations/ only, given a dir and a file in it:
    /// `temp/stations/S/B/rest` → dir `S/B`, file `rest`.
    pub fn read_file(&self, file_path: &str) -> Result<FileContent, CommandError> {
        let (dir, file) = split_workpiece_file(file_path)?;
        Ok(file_content_from_probe(&self.query(serde_json::json!({ "type": "read", "dir": dir, "file": file }))?))
    }
}

/// `temp/stations/S/B/rest` → (`S/B`, `rest`), the probe's `read` arguments.
pub fn split_workpiece_file(file_path: &str) -> Result<(String, String), CommandError> {
    let rel = file_path
        .strip_prefix("temp/stations/")
        .ok_or_else(|| CommandError::Io(format!("Only workpiece files can be read: {}", file_path)))?;
    let mut parts = rel.splitn(3, '/');
    let (Some(station), Some(bin), Some(file)) = (parts.next(), parts.next(), parts.next()) else {
        return Err(CommandError::Io(format!("Not a workpiece file: {}", file_path)));
    };
    Ok((format!("{}/{}", station, bin), file.to_string()))
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

    /// `cargo test -- --ignored every_configured_factory --nocapture` — every
    /// factory on every host in the developer's config, through the probe.
    #[test]
    #[ignore]
    fn every_configured_factory_reads_through_the_probe() {
        let cfg = crate::central_config::load().unwrap().expect("config");
        for h in &cfg.hosts {
            for w in &h.factories {
                let started = std::time::Instant::now();
                let src = Source::for_factory(&h.name, &w.name).unwrap();
                let (state, lines) = src.floor().unwrap();
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
            let (_, lines) = src.floor().unwrap();
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

#[cfg(test)]
pub mod fixtures {
    use std::path::{Path, PathBuf};

    /// A Source on this machine for a factory at `root`.
    pub fn local_source(root: &Path) -> super::Source {
        let host = crate::central_config::HostEntry { name: "local".into(), is_local: true, ssh: None, node: None, factories: vec![] };
        super::Source { host, path: root.display().to_string() }
    }

    /// A throwaway factory: line VM (VM1 → VM2, terminal VM2), an off-line
    /// station X1, a broken station file, and three workpieces.
    pub fn make_factory() -> PathBuf {
        // Parallel tests can read the same clock tick; the counter keeps names unique.
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "control-room-factory-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let st = root.join(".orchestrator").join("stations");
        std::fs::create_dir_all(&st).unwrap();
        std::fs::write(st.join("VM1__a.json"), r#"{"id":"id1","short_code":"VM1","line":"VM","dependencies":[]}"#).unwrap();
        std::fs::write(st.join("VM2__b.json"), r#"{"id":"id2","short_code":"VM2","line":"VM","dependencies":["id1"]}"#).unwrap();
        std::fs::write(st.join("X1.json"), r#"{"id":"idx","short_code":"X1"}"#).unwrap();
        std::fs::write(st.join("broken.json"), "{not json").unwrap();
        let lines = root.join(".orchestrator").join("lines");
        std::fs::create_dir_all(&lines).unwrap();
        std::fs::write(lines.join("VM.json"), r#"{"code":"VM","name":"Vendor"}"#).unwrap();
        let wp = |rel: &str, log: Option<&str>| {
            let d = root.join("temp").join("stations").join(rel);
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join("pointer.json"), "{}").unwrap();
            if let Some(l) = log {
                std::fs::write(d.join("log.jsonl"), l).unwrap();
            }
        };
        wp("VM1/output/wp-1", Some("{\"ts\":\"2026-01-01T00:00:00Z\",\"station\":\"VM1\",\"event\":\"station_complete\"}\n\nnot json\n"));
        wp("VM2/output/inv/wp-2", None);
        std::fs::create_dir_all(root.join("temp/stations/VM2/failed")).unwrap();
        root
    }
}
