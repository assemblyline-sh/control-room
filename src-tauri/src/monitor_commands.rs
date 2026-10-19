// Tauri commands that serve the watch-shell's per-resource views. Every one
// takes (host, factory), reads through a Source (source/), and builds its
// answer with monitor.rs — so the same command works against this machine
// or a remote host.

use crate::commands::CommandError;
use crate::monitor::{
    build_lines, code_of, parse_events, parse_station, resolve_position, summarize_line, workpiece_link,
    workpiece_rel_dir, LineState, LineSummary, LogEvent, Position, StationDef,
};
use crate::source::{FileContent, Source};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

type LineDefs = serde_json::Map<String, serde_json::Value>;

/// Root, line states, station defs, line defs and the orchestrator org URL.
fn lines_with_defs(
    source: &Source,
) -> Result<(String, HashMap<String, LineState>, Vec<StationDef>, LineDefs, Option<String>), CommandError> {
    let state = source.state()?;
    let lines = build_lines(&state);
    let defs = state.stations.iter().map(|s| parse_station(&s.data)).collect();
    let orchestrator = orchestrator_base(&state);
    Ok((state.root, lines, defs, state.lines, orchestrator))
}

/// `<orchestrator_url>/orgs/<org>` from the factory's committed
/// `.orchestrator/factory.json` — the base of its line, station and
/// work-record pages. `None` unless it has both.
fn orchestrator_base(state: &crate::source::RawState) -> Option<String> {
    let setting = |k: &str| state.factory.as_ref()?.get(k)?.as_str().filter(|v| !v.is_empty()).map(str::to_string);
    match (setting("orchestrator_url"), setting("org")) {
        (Some(url), Some(org)) if url.starts_with("https://") || url.starts_with("http://") => {
            Some(format!("{}/orgs/{}", url.trim_end_matches('/'), org))
        }
        _ => None,
    }
}

/// A line def's `name` / `description` (from `.orchestrator/lines/<code>.json`).
fn line_text(line_defs: &LineDefs, code: &str, key: &str) -> Option<String> {
    line_defs.get(code)?.get(key)?.as_str().map(|s| s.to_string())
}

// --------------------------- list_lines ---------------------------

#[derive(Serialize)]
pub struct LineRow {
    pub code: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub stations: Vec<String>,
    pub terminal: String,
    pub summary: LineSummary,
}

#[tauri::command]
pub async fn list_lines(host: String, factory: String) -> Result<Vec<LineRow>, CommandError> {
    let (_, lines, _, line_defs, _) = lines_with_defs(&Source::for_factory(&host, &factory)?)?;
    let mut rows: Vec<LineRow> = lines
        .into_iter()
        .map(|(code, line)| LineRow {
            name: line_text(&line_defs, &code, "name"),
            description: line_text(&line_defs, &code, "description"),
            code,
            summary: summarize_line(&line),
            stations: line.stations,
            terminal: line.terminal,
        })
        .collect();
    rows.sort_by(|a, b| a.code.cmp(&b.code));
    Ok(rows)
}

// --------------------------- show_line ---------------------------

#[derive(Serialize)]
pub struct LineDetail {
    pub code: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub terminal: String,
    pub stations: Vec<StationBinRow>,
    pub summary: LineSummary,
    /// The factory's org on the orchestrator (`<url>/orgs/<org>`), when known.
    pub orchestrator: Option<String>,
}

#[derive(Serialize)]
pub struct StationBinRow {
    pub station: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub is_terminal: bool,
    pub input: Option<u32>,
    pub doing: Option<u32>,
    pub output: Option<u32>,
    pub failed: Option<u32>,
    pub done: Option<u32>,
}

#[tauri::command]
pub async fn show_line(host: String, factory: String, line: String) -> Result<LineDetail, CommandError> {
    let (_, lines, defs, line_defs, orchestrator) = lines_with_defs(&Source::for_factory(&host, &factory)?)?;
    let line_state = lines
        .get(&line)
        .ok_or_else(|| CommandError::Io(format!("line not found: {}", line)))?;

    let rows = line_state
        .stations
        .iter()
        .map(|station| {
            let bins = line_state.bins.get(station);
            let count = |b: &str| -> Option<u32> {
                bins.and_then(|m| m.get(b)).and_then(|opt| opt.as_ref().map(|s| s.len() as u32))
            };
            let def = defs.iter().find(|d| code_of(d) == station);
            StationBinRow {
                station: station.clone(),
                name: def.and_then(|d| d.name.clone()),
                description: def.and_then(|d| d.description.clone()),
                is_terminal: station == &line_state.terminal,
                input: count("input"),
                doing: count("doing"),
                output: count("output"),
                failed: count("failed"),
                done: count("done"),
            }
        })
        .collect();

    Ok(LineDetail {
        code: line_state.code.clone(),
        name: line_text(&line_defs, &line, "name"),
        description: line_text(&line_defs, &line, "description"),
        terminal: line_state.terminal.clone(),
        stations: rows,
        summary: summarize_line(line_state),
        orchestrator,
    })
}

// --------------------------- show_station ---------------------------

#[derive(Serialize)]
pub struct StationDetail {
    pub station: String,
    pub line: String,
    pub is_terminal: bool,
    pub bins: BTreeMap<String, Vec<String>>,
    pub def: Option<StationDef>,
    /// The factory's org on the orchestrator (`<url>/orgs/<org>`), when known.
    pub orchestrator: Option<String>,
}

#[tauri::command]
pub async fn show_station(
    host: String,
    factory: String,
    line: String,
    station: String,
) -> Result<StationDetail, CommandError> {
    let (_, lines, defs, _, orchestrator) = lines_with_defs(&Source::for_factory(&host, &factory)?)?;
    let line_state = lines
        .get(&line)
        .ok_or_else(|| CommandError::Io(format!("line not found: {}", line)))?;
    let bins_for_station = line_state
        .bins
        .get(&station)
        .ok_or_else(|| CommandError::Io(format!("station not found: {}/{}", line, station)))?;

    let mut bins = BTreeMap::new();
    for (bin_name, maybe_ids) in bins_for_station {
        let mut ids: Vec<String> = maybe_ids.as_ref().map(|m| m.keys().cloned().collect()).unwrap_or_default();
        ids.sort();
        bins.insert(bin_name.clone(), ids);
    }

    Ok(StationDetail {
        is_terminal: line_state.terminal == station,
        line: line_state.code.clone(),
        def: defs.into_iter().find(|s| code_of(s) == station),
        station,
        bins,
        orchestrator,
    })
}

// --------------------------- list_bin_workpieces ---------------------------

#[derive(Serialize)]
pub struct WorkpieceRow {
    pub id: String,
    pub last_event: Option<LogEvent>,
}

#[tauri::command]
pub async fn list_bin_workpieces(
    host: String,
    factory: String,
    station: String,
    bin: String,
) -> Result<Vec<WorkpieceRow>, CommandError> {
    let source = Source::for_factory(&host, &factory)?;
    let state = source.state()?;
    let Some(Some(listing)) = state.bins.get(&station).and_then(|b| b.get(&bin)) else {
        return Ok(Vec::new());
    };
    // One logs call for the whole bin — one round trip on a remote host.
    let dirs: Vec<String> = listing.values().map(|sub| format!("{}/{}/{}", station, bin, sub)).collect();
    let logs = source.logs(&dirs)?;
    let mut rows: Vec<WorkpieceRow> = listing
        .iter()
        .map(|(id, sub)| WorkpieceRow {
            id: id.clone(),
            last_event: logs
                .get(&format!("{}/{}/{}", station, bin, sub))
                .and_then(|raw| parse_events(raw).into_iter().last()),
        })
        .collect();
    rows.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(rows)
}

// --------------------------- show_workpiece ---------------------------

#[derive(Serialize)]
pub struct WorkpieceDetail {
    pub id: String,
    pub position: Option<Position>,
    pub events: Vec<LogEvent>,
    pub folder: Option<String>,
    /// `file://` URL — local factories only.
    pub link: Option<String>,
    /// The folder's error.json, whole (stack included).
    pub error: Option<serde_json::Value>,
    /// al-control's grouping key for `error` (failures.rs).
    pub error_key: Option<String>,
    /// Every file in the folder, recursively.
    pub files: Vec<FileEntry>,
    /// The factory's org on the orchestrator (`<url>/orgs/<org>`), when known.
    pub orchestrator: Option<String>,
}

#[tauri::command]
pub async fn show_workpiece(
    host: String,
    factory: String,
    workpiece_id: String,
) -> Result<WorkpieceDetail, CommandError> {
    let source = Source::for_factory(&host, &factory)?;
    let (root, lines, _, _, orchestrator) = lines_with_defs(&source)?;
    let position = resolve_position(&workpiece_id, &lines);

    let (folder, events, error, files) = match &position {
        Some(pos) => {
            let rel = workpiece_rel_dir(pos, &workpiece_id);
            let events = source.logs(&[rel.clone()])?.remove(&rel).map(|raw: Vec<serde_json::Value>| parse_events(&raw)).unwrap_or_default();
            let wp = source.workpiece(&rel)?;
            let files = wp
                .files
                .into_iter()
                .map(|f| FileEntry { path: format!("temp/stations/{}/{}", rel, f.name), name: f.name, is_dir: false, size: Some(f.size) })
                .collect();
            (Some(format!("{}/temp/stations/{}", root, rel)), events, wp.error, files)
        }
        None => (None, Vec::new(), None, Vec::new()),
    };
    let link = folder.as_deref().filter(|_| source.is_local()).map(workpiece_link);
    // Same summary the probe's `errors` gives, so the key matches the Failures tab.
    let error_key = error.as_ref().map(|e| crate::failures::error_key(Some(&crate::source::ErrorSummary::of(e))));

    Ok(WorkpieceDetail { id: workpiece_id, position, events, folder, link, error, error_key, files, orchestrator })
}

// --------------------------- list_files_in_workpiece ---------------------------

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    /// Relative to the factory root — what `read_file` takes. Includes any
    /// sub-bin segments, which the id alone doesn't.
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
}

/// Every file in the workpiece's folder, recursively (`sub/file` names).
#[tauri::command]
pub async fn list_files_in_workpiece(
    host: String,
    factory: String,
    station: String,
    bin: String,
    workpiece: String,
) -> Result<Vec<FileEntry>, CommandError> {
    let source = Source::for_factory(&host, &factory)?;
    let state = source.state()?;
    // `workpiece` is an id, not necessarily a direct child of the bin —
    // resolve its (possibly sub-bin-nested) path from the bin listing.
    let Some(sub) = state
        .bins
        .get(&station)
        .and_then(|b| b.get(&bin))
        .and_then(|l| l.as_ref())
        .and_then(|l| l.get(&workpiece))
    else {
        return Ok(Vec::new());
    };
    let rel = format!("{}/{}/{}", station, bin, sub);
    let files = source.workpiece(&rel)?.files;
    Ok(files
        .into_iter()
        .map(|f| FileEntry {
            path: format!("temp/stations/{}/{}", rel, f.name),
            name: f.name,
            is_dir: false,
            size: Some(f.size),
        })
        .collect())
}

// --------------------------- read_factory_env ---------------------------

/// The factory repo's `.env` as a flat string map, for building orchestrator
/// links (`${ORCHESTRATOR_URL}/orgs/${ORCHESTRATOR_ORG}/work-records/<id>`).
#[tauri::command]
pub async fn read_factory_env(host: String, factory: String) -> Result<HashMap<String, String>, CommandError> {
    Source::for_factory(&host, &factory)?.env()
}

// --------------------------- read_file ---------------------------

#[tauri::command]
pub async fn read_file(host: String, factory: String, file_path: String) -> Result<FileContent, CommandError> {
    Source::for_factory(&host, &factory)?.read_file(&file_path)
}

// --------------------------- host_counts ---------------------------

/// Per-bin workpiece counts for every factory on a host, for the rail's
/// done / failed / output figures. Polled every ~2s, so it's one probe
/// round trip per host and numbers only.
#[tauri::command]
pub async fn host_counts(host: String) -> Result<HashMap<String, crate::source::FactoryCounts>, CommandError> {
    crate::source::host_counts(&crate::resolve::resolve_host(&host)?)
}
