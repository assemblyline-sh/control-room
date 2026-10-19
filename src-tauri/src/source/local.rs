// This machine's factories, read straight from disk — a Rust port of the read
// half of al-control's src/probe.js. Same rules, same JSON shapes, so the
// logic above can't tell it from the remote probe.

use std::collections::{BTreeMap, HashMap};
use std::path::{Component, Path, PathBuf};

use super::{ErrorSummary, FileEntry, RawStationDef, RawState, WorkpieceFiles};
use crate::commands::CommandError;

const MAX_FILE_READ_BYTES: u64 = 1_048_576; // 1 MiB

pub const ALL_BINS: &[&str] = &["input", "doing", "output", "failed", "done"];
// Depth limit for sub-bin walks (output/invoices/hi-1/ = depth 2).
const MAX_BIN_DEPTH: u32 = 4;

fn io(e: std::io::Error) -> CommandError {
    CommandError::Io(e.to_string())
}

/// Every `*.json` in `dir`, by filename; malformed files skipped (as the
/// probe does — one bad station file doesn't hide the rest).
fn read_json_files(dir: &Path) -> Vec<serde_json::Value> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut names: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("json"))
        .collect();
    names.sort();
    names
        .iter()
        .filter_map(|p| std::fs::read_to_string(p).ok())
        .filter_map(|t| serde_json::from_str(&t).ok())
        .collect()
}

/// Walk a bin and find every workpiece — any directory holding a
/// `pointer.json` — descending through organisational sub-bins
/// (`output/invoices/`) up to MAX_BIN_DEPTH. id → path relative to the bin.
///
/// With `orphans`, a directory with no `pointer.json` that holds files itself
/// (sub-bins hold only folders) is recorded there instead of walked into.
pub fn scan_bin_workpieces(bin_dir: &Path, orphans: Option<&mut HashMap<String, String>>) -> HashMap<String, String> {
    let mut found = HashMap::new();
    walk_bin(bin_dir, 0, "", &mut found, orphans);
    found
}

fn holds_files(dir: &Path) -> bool {
    std::fs::read_dir(dir)
        .map(|it| it.flatten().any(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false)))
        .unwrap_or(false)
}

fn walk_bin(
    dir: &Path,
    depth: u32,
    relpath: &str,
    found: &mut HashMap<String, String>,
    mut orphans: Option<&mut HashMap<String, String>>,
) {
    if depth >= MAX_BIN_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(|s| s.to_string()) else { continue };
        if name.starts_with('.') {
            continue;
        }
        let child = entry.path();
        let child_rel = if relpath.is_empty() { name.clone() } else { format!("{}/{}", relpath, name) };
        if child.join("pointer.json").exists() {
            found.insert(name, child_rel);
        } else if orphans.is_some() && holds_files(&child) {
            orphans.as_deref_mut().unwrap().insert(name, child_rel);
        } else {
            walk_bin(&child, depth + 1, &child_rel, found, orphans.as_deref_mut());
        }
    }
}

/// Probe `state`.
pub fn read_state(root: &Path) -> Result<RawState, CommandError> {
    if !root.exists() {
        return Err(CommandError::Io(format!("Factory directory does not exist: {}", root.display())));
    }
    let stations: Vec<RawStationDef> = read_json_files(&root.join(".orchestrator").join("stations"))
        .into_iter()
        .map(|data| RawStationDef { line: data.get("line").and_then(|l| l.as_str()).map(String::from), data })
        .collect();
    let mut lines = serde_json::Map::new();
    for data in read_json_files(&root.join(".orchestrator").join("lines")) {
        if let Some(code) = data.get("code").and_then(|c| c.as_str()) {
            lines.insert(code.to_string(), data.clone());
        }
    }

    let stations_root = root.join("temp").join("stations");
    let mut bins = HashMap::new();
    let mut orphans = HashMap::new();
    for s in stations.iter().filter(|s| s.line.is_some()) {
        let code = s
            .data
            .get("short_code")
            .and_then(|c| c.as_str())
            .filter(|c| !c.is_empty())
            .or_else(|| s.data.get("id").and_then(|c| c.as_str()))
            .unwrap_or_default()
            .to_string();
        let mut by_bin = BTreeMap::new();
        let mut found_orphans = HashMap::new();
        for bin in ALL_BINS {
            let dir = stations_root.join(&code).join(bin);
            let tracked = (*bin == "failed").then_some(&mut found_orphans);
            by_bin.insert((*bin).to_string(), dir.exists().then(|| scan_bin_workpieces(&dir, tracked)));
        }
        if !found_orphans.is_empty() {
            orphans.insert(code.clone(), found_orphans);
        }
        bins.insert(code, by_bin);
    }

    let factory = std::fs::read_to_string(root.join(".orchestrator").join("factory.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok());

    Ok(RawState { root: root.display().to_string(), stations, lines, bins, orphans, factory })
}

/// Probe `counts` for one factory: per-bin numbers and station → line.
pub fn read_counts(root: &Path) -> Result<super::FactoryCounts, CommandError> {
    let state = read_state(root)?;
    let mut lines = HashMap::new();
    for s in &state.stations {
        if let Some(line) = &s.line {
            let code = s.data.get("short_code").and_then(|c| c.as_str()).filter(|c| !c.is_empty())
                .or_else(|| s.data.get("id").and_then(|c| c.as_str()))
                .unwrap_or_default();
            lines.insert(code.to_string(), line.clone());
        }
    }
    let orphans = state.orphans.iter().map(|(code, dirs)| (code.clone(), dirs.len() as u32)).collect();
    let counts = state
        .bins
        .into_iter()
        .map(|(code, by_bin)| (code, by_bin.into_iter().map(|(bin, ids)| (bin, ids.map(|m| m.len() as u32))).collect()))
        .collect();
    Ok(super::FactoryCounts { root: Some(state.root), lines, counts, orphans, error: None })
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

/// Probe `ages`: the later of each dir's and its log.jsonl's mtime, in ms.
pub fn read_ages(root: &Path, dirs: &[String]) -> Result<HashMap<String, Option<u64>>, CommandError> {
    let mtime = |p: &Path| -> Option<u64> {
        let t = std::fs::metadata(p).ok()?.modified().ok()?;
        Some(t.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64)
    };
    let mut out = HashMap::new();
    for rel in dirs {
        let dir = stations_path(root, rel)?;
        let age = mtime(&dir).map(|d| d.max(mtime(&dir.join("log.jsonl")).unwrap_or(0)));
        out.insert(rel.clone(), age);
    }
    Ok(out)
}

/// Probe `errors`: error.json summaries (no stack; message capped).
pub fn read_errors(root: &Path, dirs: &[String]) -> Result<HashMap<String, Option<ErrorSummary>>, CommandError> {
    let mut out = HashMap::new();
    for rel in dirs {
        let error = std::fs::read_to_string(stations_path(root, rel)?.join("error.json"))
            .ok()
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
            .filter(|v| v.is_object())
            .map(|e| ErrorSummary::of(&e));
        out.insert(rel.clone(), error);
    }
    Ok(out)
}

/// Probe `remove`: every dir is checked before any is deleted — under
/// temp/stations/, in a `done` or `output` bin, not kept, has pointer.json.
pub fn remove_workpieces(root: &Path, dirs: &[String], keep: &[String]) -> Result<usize, CommandError> {
    let mut targets = Vec::new();
    for rel in dirs {
        let mut parts = rel.split('/');
        let (station, bin) = (parts.next().unwrap_or_default(), parts.next().unwrap_or_default());
        if bin != "done" && bin != "output" {
            return Err(CommandError::Refused(format!("Only done and output bins can be cleared: {}", rel)));
        }
        if keep.iter().any(|k| k == &format!("{}/{}", station, bin)) {
            return Err(CommandError::Refused(format!("{}/{} is in this factory's keep list", station, bin)));
        }
        let abs = stations_path(root, rel)?;
        if !abs.join("pointer.json").exists() {
            return Err(CommandError::Refused(format!("Not a workpiece (no pointer.json): {}", rel)));
        }
        targets.push(abs);
    }
    for abs in &targets {
        std::fs::remove_dir_all(abs).map_err(io)?;
    }
    Ok(targets.len())
}

/// Probe `requeue`: every dir is checked before any moves — under
/// temp/stations/, a workpiece in a `failed` or `done` bin, and its station's
/// `input/<id>` free. Lands flat at `input/<id>` (lib-factory reads input
/// flat), minus error.json / error.txt, with a `requeued` log event.
pub fn requeue_workpieces(root: &Path, dirs: &[String]) -> Result<usize, CommandError> {
    let stations_root = lexical(&root.join("temp").join("stations"));
    let mut moves: Vec<(PathBuf, PathBuf, String, String)> = Vec::new();
    for rel in dirs {
        let abs = stations_path(root, rel)?;
        // The normalised path, so `X/failed/../output/wp` can't pass as failed.
        let mut parts = abs.strip_prefix(&stations_root).unwrap_or(&abs).components().map(|c| c.as_os_str().to_string_lossy().to_string());
        let (station, bin) = (parts.next().unwrap_or_default(), parts.next().unwrap_or_default());
        if bin != "failed" && bin != "done" {
            return Err(CommandError::Refused(format!("Only failed and done workpieces can be retried: {}", rel)));
        }
        if !abs.join("pointer.json").exists() {
            return Err(CommandError::Refused(format!("Not a workpiece (no pointer.json): {}", rel)));
        }
        let id = abs.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let target = stations_root.join(&station).join("input").join(&id);
        if target.exists() || moves.iter().any(|m| m.1 == target) {
            return Err(CommandError::Refused(format!("{}/input/{} already exists", station, id)));
        }
        moves.push((abs, target, station, bin));
    }
    for (abs, target, station, bin) in &moves {
        for stale in ["error.json", "error.txt"] {
            match std::fs::remove_file(abs.join(stale)) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(io(e)),
                _ => {}
            }
        }
        let event = serde_json::json!({ "ts": iso_time(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)), "station": station, "event": "requeued", "from": bin });
        let mut log = std::fs::OpenOptions::new().create(true).append(true).open(abs.join("log.jsonl")).map_err(io)?;
        std::io::Write::write_all(&mut log, format!("{}\n", event).as_bytes()).map_err(io)?;
        std::fs::create_dir_all(target.parent().unwrap_or(&stations_root)).map_err(io)?;
        std::fs::rename(abs, target).map_err(io)?;
    }
    Ok(moves.len())
}

/// Ms since the epoch as `new Date(ms).toISOString()` writes it, e.g.
/// `2026-10-10T17:48:42.947Z` — log.jsonl's `ts` format — without a date crate.
fn iso_time(ms: i64) -> String {
    let (days, rem) = (ms.div_euclid(86_400_000), ms.rem_euclid(86_400_000));
    // Days since 1970-01-01 → civil date (Howard Hinnant's days_from_civil, inverted).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year,
        month,
        day,
        rem / 3_600_000,
        rem / 60_000 % 60,
        rem / 1000 % 60,
        rem % 1000
    )
}

/// Probe `logs`: parsed `log.jsonl` per dir; blank and malformed lines dropped.
pub fn read_logs(root: &Path, dirs: &[String]) -> Result<HashMap<String, Vec<serde_json::Value>>, CommandError> {
    let mut out = HashMap::new();
    for rel in dirs {
        let log = stations_path(root, rel)?.join("log.jsonl");
        let events = match std::fs::read_to_string(&log) {
            Ok(text) => text
                .lines()
                .filter(|l| !l.trim().is_empty())
                .filter_map(|l| serde_json::from_str(l).ok())
                .collect(),
            Err(_) => Vec::new(),
        };
        out.insert(rel.clone(), events);
    }
    Ok(out)
}

/// Probe `workpiece`: every file under the dir (relative names, sizes, by
/// name) and its `error.json`.
pub fn read_workpiece(root: &Path, rel: &str) -> Result<WorkpieceFiles, CommandError> {
    let dir = stations_path(root, rel)?;
    if !dir.exists() {
        return Err(CommandError::Io(format!("No workpiece folder at temp/stations/{}", rel)));
    }
    let mut files = Vec::new();
    walk_files(&dir, "", &mut files)?;
    let error = std::fs::read_to_string(dir.join("error.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok());
    Ok(WorkpieceFiles { files, error })
}

fn walk_files(dir: &Path, prefix: &str, out: &mut Vec<FileEntry>) -> Result<(), CommandError> {
    let mut entries: Vec<_> = std::fs::read_dir(dir).map_err(io)?.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let name = format!("{}{}", prefix, entry.file_name().to_string_lossy());
        let meta = entry.metadata().map_err(io)?;
        if meta.is_dir() {
            walk_files(&entry.path(), &format!("{}/", name), out)?;
        } else {
            out.push(FileEntry { name, size: meta.len() });
        }
    }
    Ok(())
}

/// The factory's `.env` as a flat map — blank lines and `# …` skipped, one
/// pair of matching outer quotes stripped, malformed lines ignored. Empty
/// when there's no `.env`.
pub fn read_env(root: &Path) -> Result<HashMap<String, String>, CommandError> {
    let path = root.join(".env");
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let contents = std::fs::read_to_string(&path).map_err(|e| CommandError::Io(e.to_string()))?;
    let mut out = HashMap::new();
    for raw in contents.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        let key = k.trim().to_string();
        let mut value = v.trim().to_string();
        // Strip matched outer quotes.
        if value.len() >= 2 {
            let bytes = value.as_bytes();
            let first = bytes[0];
            let last = bytes[bytes.len() - 1];
            if (first == b'"' || first == b'\'') && first == last {
                value = value[1..value.len() - 1].to_string();
            }
        }
        if !key.is_empty() {
            out.insert(key, value);
        }
    }
    Ok(out)
}

/// A file in the factory repo, by path relative to the root (absolute paths
/// must also stay inside it). Lexical containment, not canonicalize — a
/// symlinked repo is the user's choice. Larger than the cap → truncated.
pub fn read_file(root: &Path, file_path: &str) -> Result<super::FileContent, CommandError> {
    let factory = root.to_path_buf();
    let candidate = if Path::new(&file_path).is_absolute() {
        PathBuf::from(&file_path)
    } else {
        factory.join(&file_path)
    };

    // Reject anything that escapes the factory repo via .. components. We
    // intentionally avoid std::fs::canonicalize here because symlinks under
    // factory_path would otherwise prevent reads — and the user did pick this
    // folder themselves. Lexical containment is enough.
    let resolved = lexical(&candidate);
    let resolved_factory = lexical(&factory);
    if !resolved.starts_with(&resolved_factory) {
        return Err(CommandError::Io(format!(
            "refused to read outside factory repo: {}",
            file_path
        )));
    }

    let meta = std::fs::metadata(&resolved).map_err(|e| CommandError::Io(e.to_string()))?;
    let size = meta.len();
    if !meta.is_file() {
        return Err(CommandError::Io(format!(
            "not a file: {}",
            resolved.display()
        )));
    }

    let truncated = size > MAX_FILE_READ_BYTES;
    let bytes = if truncated {
        let mut buf = vec![0u8; MAX_FILE_READ_BYTES as usize];
        use std::io::Read;
        let mut f = std::fs::File::open(&resolved).map_err(|e| CommandError::Io(e.to_string()))?;
        f.read_exact(&mut buf)
            .map_err(|e| CommandError::Io(e.to_string()))?;
        buf
    } else {
        std::fs::read(&resolved).map_err(|e| CommandError::Io(e.to_string()))?
    };

    let is_binary = bytes.iter().take(8192).any(|b| *b == 0);
    let content = if is_binary { String::new() } else { String::from_utf8_lossy(&bytes).into_owned() };
    Ok(super::FileContent {
        content,
        size,
        truncated,
        is_binary,
    })
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// A factory with line VM: VM1 → VM2 (terminal), plus a station with no line.
    ///   VM1/output/wp-1         flat workpiece, with a log
    ///   VM2/output/inv/wp-2     workpiece under a sub-bin
    ///   VM2/failed/             exists, empty
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

    #[test]
    fn factory_json_is_read_when_present() {
        let root = make_factory();
        assert_eq!(read_state(&root).unwrap().factory, None);
        std::fs::write(root.join(".orchestrator/factory.json"), r#"{"orchestrator_url":"https://o.example","org":"alex"}"#).unwrap();
        assert_eq!(read_state(&root).unwrap().factory.unwrap()["org"], "alex");
    }

    #[test]
    fn failed_folders_without_pointer_are_orphans() {
        let root = make_factory();
        let failed = root.join("temp/stations/VM2/failed");
        std::fs::create_dir_all(failed.join("orphan-1")).unwrap();
        std::fs::write(failed.join("orphan-1/error.json"), "{}").unwrap();
        std::fs::create_dir_all(failed.join("inv/wp-4")).unwrap();
        std::fs::write(failed.join("inv/wp-4/pointer.json"), "{}").unwrap();
        let state = read_state(&root).unwrap();
        assert_eq!(state.orphans["VM2"], HashMap::from([("orphan-1".to_string(), "orphan-1".to_string())]));
        assert_eq!(state.bins["VM2"]["failed"].as_ref().unwrap()["wp-4"], "inv/wp-4");
        assert_eq!(read_counts(&root).unwrap().orphans["VM2"], 1);
    }

    #[test]
    fn ages_take_the_later_of_folder_and_log() {
        let root = make_factory();
        let dir = root.join("temp/stations/VM1/output/wp-1");
        let log_time = std::time::UNIX_EPOCH + std::time::Duration::from_secs(4_000_000_000);
        std::fs::File::options().write(true).open(dir.join("log.jsonl")).unwrap().set_modified(log_time).unwrap();
        let ages = read_ages(&root, &["VM1/output/wp-1".into(), "VM1/done/gone".into()]).unwrap();
        assert_eq!(ages["VM1/output/wp-1"], Some(4_000_000_000_000));
        assert_eq!(ages["VM1/done/gone"], None);
    }

    #[test]
    fn state_matches_the_probe_shape() {
        let root = make_factory();
        let s = read_state(&root).unwrap();
        assert_eq!(s.stations.len(), 3, "broken.json skipped");
        assert_eq!(s.lines["VM"]["name"], "Vendor");
        assert_eq!(s.bins["VM1"]["output"].as_ref().unwrap()["wp-1"], "wp-1");
        assert_eq!(s.bins["VM2"]["output"].as_ref().unwrap()["wp-2"], "inv/wp-2");
        assert_eq!(s.bins["VM2"]["failed"].as_ref().unwrap().len(), 0);
        assert!(s.bins["VM1"]["input"].is_none());
        assert!(!s.bins.contains_key("X1"), "stations without a line have no bins");
    }

    #[test]
    fn requeue_moves_failed_and_done_to_their_own_input_flat() {
        let root = make_factory();
        let st = root.join("temp/stations");
        let failed = st.join("VM2/failed/wp-3");
        std::fs::create_dir_all(failed.join("sub")).unwrap();
        std::fs::write(failed.join("pointer.json"), "{}").unwrap();
        std::fs::write(failed.join("sub/doc.pdf"), [0u8]).unwrap();
        std::fs::write(failed.join("error.json"), "{}").unwrap();
        std::fs::write(failed.join("error.txt"), "boom").unwrap();
        std::fs::write(failed.join("log.jsonl"), "{\"ts\":\"t\",\"station\":\"VM2\",\"event\":\"station_failed\"}\n").unwrap();
        std::fs::create_dir_all(st.join("VM1/done/inv/wp-0")).unwrap();
        std::fs::write(st.join("VM1/done/inv/wp-0/pointer.json"), "{}").unwrap();

        assert_eq!(requeue_workpieces(&root, &["VM2/failed/wp-3".into(), "VM1/done/inv/wp-0".into()]).unwrap(), 2);

        let moved = st.join("VM2/input/wp-3");
        assert!(!failed.exists());
        assert!(moved.join("sub/doc.pdf").exists());
        assert!(!moved.join("error.json").exists() && !moved.join("error.txt").exists());
        let events = read_logs(&root, &["VM2/input/wp-3".into()]).unwrap().remove("VM2/input/wp-3").unwrap();
        assert_eq!(events.iter().map(|e| e["event"].as_str().unwrap()).collect::<Vec<_>>(), ["station_failed", "requeued"]);
        assert_eq!(events[1]["from"], "failed");
        assert!(st.join("VM1/input/wp-0/pointer.json").exists(), "sub-bin source lands flat");
    }

    #[test]
    fn requeue_refuses_the_whole_batch() {
        let root = make_factory();
        let st = root.join("temp/stations");
        std::fs::create_dir_all(st.join("VM2/failed/wp-3")).unwrap();
        std::fs::write(st.join("VM2/failed/wp-3/pointer.json"), "{}").unwrap();
        std::fs::write(st.join("VM2/failed/wp-3/error.json"), "{}").unwrap();
        std::fs::create_dir_all(st.join("VM2/failed/orphan-1")).unwrap();
        for (bad, msg) in [
            ("VM1/output/wp-1", "Only failed and done"),
            ("VM2/failed/../output/inv/wp-2", "Only failed and done"),
            ("VM2/failed/orphan-1", "no pointer.json"),
            ("VM2/failed/../../../../x", "outside temp/stations"),
        ] {
            let err = requeue_workpieces(&root, &["VM2/failed/wp-3".into(), bad.into()]).unwrap_err().to_string();
            assert!(err.contains(msg), "{}: {}", bad, err);
            assert!(st.join("VM2/failed/wp-3/error.json").exists(), "nothing touched for {}", bad);
        }
        std::fs::create_dir_all(st.join("VM2/input/wp-3")).unwrap();
        assert!(requeue_workpieces(&root, &["VM2/failed/wp-3".into()]).unwrap_err().to_string().contains("already exists"));
        assert!(st.join("VM2/failed/wp-3").exists());
    }

    #[test]
    fn iso_time_matches_javascript() {
        assert_eq!(iso_time(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_time(951_782_400_000), "2000-02-29T00:00:00.000Z");
        assert_eq!(iso_time(1_791_654_522_947), "2026-10-10T17:48:42.947Z");
        assert_eq!(iso_time(4_102_444_799_999), "2099-12-31T23:59:59.999Z");
    }

    #[test]
    fn logs_drop_blank_and_malformed_lines() {
        let root = make_factory();
        let logs = read_logs(&root, &["VM1/output/wp-1".into(), "VM2/output/inv/wp-2".into()]).unwrap();
        assert_eq!(logs["VM1/output/wp-1"].len(), 1);
        assert_eq!(logs["VM2/output/inv/wp-2"].len(), 0);
        assert!(read_logs(&root, &["../../.orchestrator".into()]).is_err());
    }

    #[test]
    fn workpiece_lists_files_recursively() {
        let root = make_factory();
        let d = root.join("temp/stations/VM1/output/wp-1/sub");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("doc.pdf"), [0u8, 1, 2]).unwrap();
        std::fs::write(root.join("temp/stations/VM1/output/wp-1/error.json"), r#"{"message":"boom"}"#).unwrap();
        let w = read_workpiece(&root, "VM1/output/wp-1").unwrap();
        assert_eq!(w.files.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), ["error.json", "log.jsonl", "pointer.json", "sub/doc.pdf"]);
        assert_eq!(w.files[3].size, 3);
        assert_eq!(w.error.unwrap()["message"], "boom");
    }

    #[test]
    fn stations_path_refuses_escapes() {
        let root = make_factory();
        assert!(stations_path(&root, "VM1/done/x").is_ok());
        assert!(stations_path(&root, "../x").is_err());
        assert!(stations_path(&root, "VM1/../../x").is_err());
        assert!(stations_path(&root, "").is_err());
    }
}

#[cfg(test)]
mod probe_parity {
    use super::*;

    /// `cargo test -- --ignored probe_parity` — for every local factory in the
    /// developer's config, run al-control's probe.js with node and check
    /// `state` matches this port exactly. Needs node and a al-control checkout
    /// at CR_FACTORY_PROBE (default ../../../cli/al-control/src/probe.js).
    #[test]
    #[ignore]
    fn local_state_matches_al_control_probe() {
        let probe = std::env::var("CR_FACTORY_PROBE")
            .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../../../cli/al-control/src/probe.js").into());
        let source = std::fs::read_to_string(&probe).expect("probe.js");
        let cfg = crate::central_config::load().unwrap().expect("config");
        let local = cfg.hosts.iter().find(|h| h.is_local).expect("local host");
        for w in &local.factories {
            let root = PathBuf::from(w.abs_path.as_ref().unwrap());
            let query = serde_json::json!({ "type": "state", "path": root });
            let out = std::process::Command::new("node")
                .args(["--input-type=module", "-"])
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .spawn()
                .and_then(|mut c| {
                    use std::io::Write;
                    c.stdin.take().unwrap().write_all(format!("{}\nmain({});\n", source, query).as_bytes())?;
                    c.wait_with_output()
                })
                .unwrap();
            let envelope: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
            assert_eq!(envelope["ok"], true, "{}: {}", w.name, envelope);
            let theirs: RawState = serde_json::from_value(envelope["data"].clone()).unwrap();
            let ours = read_state(&root).unwrap();
            assert_eq!(ours.bins, theirs.bins, "{}: bins differ", w.name);
            assert_eq!(serde_json::to_value(&ours.stations).unwrap(), serde_json::to_value(&theirs.stations).unwrap(), "{}: stations differ", w.name);
            assert_eq!(ours.lines, theirs.lines, "{}: lines differ", w.name);
            assert_eq!(ours.orphans, theirs.orphans, "{}: orphans differ", w.name);
            assert_eq!(ours.factory, theirs.factory, "{}: factory.json differs", w.name);
            let n: usize = ours.bins.values().flat_map(|b| b.values()).map(|l| l.as_ref().map_or(0, |m| m.len())).sum();
            println!("{:<20} {:>3} stations  {:>6} workpieces  — identical", w.name, ours.stations.len(), n);
        }
    }
}
