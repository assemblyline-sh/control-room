// Line state — operational view of the assembly-line filesystem.
//
// Port of al-control's src/utils/line-state.js: pure logic over a
// `RawState` read by a Source (source/local.rs here, the probe on a remote
// host). Nothing in this file touches a disk. Topology comes from the
// station defs (each def's `line` is the authoritative line membership;
// `dependencies` drive topo order).
//
// Mental model (see fde-handbook/patterns/structural/assembly-line-processing.md):
//   - Live bins (workpiece's current location): input | doing | output | failed
//   - Archive bin (receipt of a successful forward move): done — NOT a position
//   - Position rule: walk stations terminal → source; at each, check
//     output > doing > input > failed; first match wins. done ignored.

use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};

use crate::source::RawState;

pub const LIVE_BINS: &[&str] = &["input", "doing", "output", "failed"];
// Most-advanced first — see resolve_position.
pub const LIVE_PRIORITY: &[&str] = &["output", "doing", "input", "failed"];

#[derive(Debug, Clone, Serialize)]
pub struct StationDef {
    pub id: String,
    pub short_code: Option<String>,
    pub line: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub is_enabled: Option<bool>,
    // dependencies normalized to a list of reference strings (each is whatever
    // the JSON had — short_code OR id; we look both up at topo time).
    pub dependencies: Vec<String>,
}

/// Returns whatever station_code helps a downstream lookup — short_code if
/// present, otherwise id. Port of `codeOf`.
pub fn code_of(s: &StationDef) -> &str {
    s.short_code.as_deref().unwrap_or(&s.id)
}

pub fn parse_station(v: &serde_json::Value) -> StationDef {
    let str_at = |k: &str| v.get(k).and_then(|x| x.as_str()).map(|s| s.to_string());
    let deps: Vec<String> = v
        .get("dependencies")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|d| {
                    if let Some(s) = d.as_str() {
                        Some(s.to_string())
                    } else if let Some(obj) = d.as_object() {
                        obj.get("short_code")
                            .and_then(|x| x.as_str())
                            .or_else(|| obj.get("id").and_then(|x| x.as_str()))
                            .map(|s| s.to_string())
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    StationDef {
        id: str_at("id").unwrap_or_default(),
        short_code: str_at("short_code"),
        line: str_at("line"),
        name: str_at("name"),
        description: str_at("description"),
        is_enabled: v.get("is_enabled").and_then(|x| x.as_bool()),
        dependencies: deps,
    }
}

/// Topologically sort station defs within a single line by their dependency
/// edges. Port of `topoSortStations`. Dependencies may reference peers by
/// short_code OR id; we index both forms to avoid silently dropping id-based
/// edges.
pub fn topo_sort_stations(members: &[StationDef]) -> Vec<StationDef> {
    // Build a reference index (short_code AND id both map to the def).
    let mut by_ref: HashMap<String, usize> = HashMap::new();
    for (i, s) in members.iter().enumerate() {
        by_ref.insert(code_of(s).to_string(), i);
        if !s.id.is_empty() {
            by_ref.insert(s.id.clone(), i);
        }
        if let Some(c) = &s.short_code {
            by_ref.insert(c.clone(), i);
        }
    }

    // Alphabetical pre-sort for stable ordering when topo has ties.
    let mut sorted_idx: Vec<usize> = (0..members.len()).collect();
    sorted_idx.sort_by(|&a, &b| code_of(&members[a]).cmp(code_of(&members[b])));

    let mut visited: HashSet<usize> = HashSet::new();
    let mut result_idx: Vec<usize> = Vec::with_capacity(members.len());

    fn visit(
        i: usize,
        members: &[StationDef],
        by_ref: &HashMap<String, usize>,
        visited: &mut HashSet<usize>,
        result: &mut Vec<usize>,
    ) {
        if !visited.insert(i) {
            return;
        }
        for dep_ref in &members[i].dependencies {
            if let Some(&dep_i) = by_ref.get(dep_ref) {
                visit(dep_i, members, by_ref, visited, result);
            }
        }
        result.push(i);
    }

    for &i in &sorted_idx {
        visit(i, members, &by_ref, &mut visited, &mut result_idx);
    }

    result_idx.into_iter().map(|i| members[i].clone()).collect()
}

/// Terminal = station that no in-line peer depends on (sink of the DAG).
/// When the line has multiple sinks, pick the one latest in topo order.
/// Port of `computeTerminal`.
pub fn compute_terminal(ordered: &[StationDef]) -> String {
    if ordered.is_empty() {
        return String::new();
    }
    let codes: HashSet<String> = ordered.iter().map(|s| code_of(s).to_string()).collect();
    let mut id_to_code: HashMap<String, String> = HashMap::new();
    for s in ordered {
        if !s.id.is_empty() {
            id_to_code.insert(s.id.clone(), code_of(s).to_string());
        }
    }

    let mut depended_on: HashSet<String> = HashSet::new();
    for s in ordered {
        for d in &s.dependencies {
            if codes.contains(d) {
                depended_on.insert(d.clone());
            } else if let Some(c) = id_to_code.get(d) {
                depended_on.insert(c.clone());
            }
        }
    }

    for s in ordered.iter().rev() {
        let c = code_of(s);
        if !depended_on.contains(c) {
            return c.to_string();
        }
    }
    // Fully cyclic (shouldn't happen in a DAG); fall back to last in topo order.
    code_of(ordered.last().unwrap()).to_string()
}

#[derive(Debug, Clone)]
pub struct LineState {
    pub code: String,
    pub stations: Vec<String>, // topo-ordered
    pub terminal: String,
    // bins[station][bin] = Some(map of workpiece_id -> path relative to the
    // bin dir, e.g. "invoices/hi-1" for a sub-bin), or None if the bin dir
    // doesn't exist on disk.
    pub bins: BTreeMap<String, BTreeMap<String, Option<HashMap<String, String>>>>,
}

/// Per-line operational state from a Source's `RawState`. Port of
/// `buildLineState`.
pub fn build_lines(state: &RawState) -> HashMap<String, LineState> {
    let mut grouped: HashMap<String, Vec<StationDef>> = HashMap::new();
    for raw in &state.stations {
        if let Some(line) = &raw.line {
            grouped.entry(line.clone()).or_default().push(parse_station(&raw.data));
        }
    }

    let mut lines = HashMap::new();
    for (line_code, members) in grouped {
        let ordered = topo_sort_stations(&members);
        let station_codes: Vec<String> = ordered.iter().map(|s| code_of(s).to_string()).collect();
        let terminal = compute_terminal(&ordered);
        let mut bins = BTreeMap::new();
        for station in &station_codes {
            let by_bin = state.bins.get(station).cloned().unwrap_or_default();
            bins.insert(station.clone(), by_bin);
        }
        lines.insert(line_code.clone(), LineState { code: line_code, stations: station_codes, terminal, bins });
    }
    lines
}

#[derive(Debug, Clone, Serialize)]
pub struct Position {
    pub line: String,
    pub station: String,
    pub bin: String,
    // Path relative to the bin dir — equals workpiece_id for flat layouts,
    // prefixed with sub-bin segments for nested ones (e.g. "invoices/hi-1").
    pub subpath: String,
    pub terminal: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub anomaly: bool,
}

/// Resolve a workpiece's live position. Port of `resolvePosition`.
pub fn resolve_position(
    workpiece_id: &str,
    lines: &HashMap<String, LineState>,
) -> Option<Position> {
    for line in lines.values() {
        for station in line.stations.iter().rev() {
            for bin in LIVE_PRIORITY {
                if let Some(Some(ids)) = line.bins.get(station).and_then(|m| m.get(*bin)) {
                    if let Some(subpath) = ids.get(workpiece_id) {
                        return Some(Position {
                            line: line.code.clone(),
                            station: station.clone(),
                            bin: (*bin).to_string(),
                            subpath: subpath.clone(),
                            terminal: station == &line.terminal,
                            anomaly: false,
                        });
                    }
                }
            }
        }
    }
    // Fall back to done: anomaly path.
    for line in lines.values() {
        for station in line.stations.iter().rev() {
            if let Some(Some(ids)) = line.bins.get(station).and_then(|m| m.get("done")) {
                if let Some(subpath) = ids.get(workpiece_id) {
                    return Some(Position {
                        line: line.code.clone(),
                        station: station.clone(),
                        bin: "done".to_string(),
                        subpath: subpath.clone(),
                        terminal: station == &line.terminal,
                        anomaly: true,
                    });
                }
            }
        }
    }
    None
}

#[derive(Debug, Clone, Serialize)]
pub struct LogEvent {
    pub ts: String,
    pub station: String,
    pub event: String,
    /// The orchestrator work record of the run that logged it (lib-factory's `wr`).
    pub wr: Option<String>,
}

/// Events from a Source's raw log objects; ones missing `ts`, `station` or
/// `event` are dropped.
pub fn parse_events(raw: &[serde_json::Value]) -> Vec<LogEvent> {
    raw.iter()
        .filter_map(|v| {
            Some(LogEvent {
                ts: v.get("ts")?.as_str()?.to_string(),
                station: v.get("station")?.as_str()?.to_string(),
                event: v.get("event")?.as_str()?.to_string(),
                wr: v.get("wr").and_then(|w| w.as_str()).map(str::to_string),
            })
        })
        .collect()
}

#[derive(Debug, Clone, Serialize)]
pub struct LineSummary {
    pub in_flight: u32,
    pub stuck: u32,
    pub finished: u32,
    pub stuck_locations: Vec<String>,
    pub biggest_flow: BiggestFlow,
}

#[derive(Debug, Clone, Serialize)]
pub struct BiggestFlow {
    pub count: u32,
    pub at: Option<String>,
}

/// Per-line operational totals from live bins only. Port of `summarizeLine`.
pub fn summarize_line(line: &LineState) -> LineSummary {
    let mut in_flight = 0u32;
    let mut stuck = 0u32;
    let mut finished = 0u32;
    let mut stuck_locations = Vec::new();
    let mut biggest_flow = BiggestFlow { count: 0, at: None };

    for station in &line.stations {
        let is_terminal = station == &line.terminal;
        let bins = match line.bins.get(station) {
            Some(b) => b,
            None => continue,
        };
        for bin in LIVE_BINS {
            let Some(Some(ids)) = bins.get(*bin) else {
                continue;
            };
            let n = ids.len() as u32;
            if *bin == "failed" {
                stuck += n;
                if n > 0 {
                    stuck_locations.push(format!("{} at {}/failed", n, station));
                }
            } else if is_terminal && *bin == "output" {
                finished += n;
            } else {
                in_flight += n;
                if n > biggest_flow.count {
                    biggest_flow = BiggestFlow {
                        count: n,
                        at: Some(format!("{}/{}", station, bin)),
                    };
                }
            }
        }
    }

    LineSummary {
        in_flight,
        stuck,
        finished,
        stuck_locations,
        biggest_flow,
    }
}

/// A workpiece's dir relative to temp/stations/ — the form Source queries
/// take. Uses `pos.subpath` so sub-bin layouts resolve; falls back to the id.
pub fn workpiece_rel_dir(pos: &Position, workpiece_id: &str) -> String {
    let sub = if pos.subpath.is_empty() { workpiece_id } else { &pos.subpath };
    format!("{}/{}/{}", pos.station, pos.bin, sub)
}

/// `file://` URL for a workpiece directory. Slashes preserved, other special
/// chars percent-encoded by `urlencoding::encode_binary` semantics applied
/// per segment.
pub fn workpiece_link(workpiece_dir: &str) -> String {
    let s = workpiece_dir;
    let encoded = percent_encode_path(s);
    format!("file://{}", encoded)
}

fn percent_encode_path(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' | '/' | '\\' => out.push(ch),
            _ => {
                let mut buf = [0u8; 4];
                for b in ch.encode_utf8(&mut buf).bytes() {
                    out.push_str(&format!("%{:02X}", b));
                }
            }
        }
    }
    out
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::local::{read_state, tests::make_factory};

    #[test]
    fn orders_stations_finds_terminal_resolves_positions() {
        let lines = build_lines(&read_state(&make_factory()).unwrap());
        let vm = &lines["VM"];
        assert_eq!(vm.stations, ["VM1", "VM2"]);
        assert_eq!(vm.terminal, "VM2");

        let pos = resolve_position("wp-2", &lines).unwrap();
        assert_eq!((pos.station.as_str(), pos.bin.as_str(), pos.subpath.as_str(), pos.terminal), ("VM2", "output", "inv/wp-2", true));
        assert_eq!(workpiece_rel_dir(&pos, "wp-2"), "VM2/output/inv/wp-2");

        let sum = summarize_line(vm);
        assert_eq!((sum.in_flight, sum.stuck, sum.finished), (1, 0, 1));
    }
}
