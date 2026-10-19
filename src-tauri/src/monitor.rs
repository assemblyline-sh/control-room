// Line state — operational view of the assembly-line filesystem.
//
// The view-side half of al-control's src/utils/line-state.js. Station order,
// terminal stations and line summaries come from the probe's `lines` query
// (al-control decision 0006); this file joins them with `state`'s bins and
// resolves positions. Nothing in this file touches a disk.
//
// Mental model (see fde-handbook/patterns/structural/assembly-line-processing.md):
//   - Live bins (workpiece's current location): input | doing | output | failed
//   - Archive bin (receipt of a successful forward move): done — NOT a position
//   - Position rule: walk stations terminal → source; at each, check
//     output > doing > input > failed; first match wins. done ignored.

use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

use crate::source::{Lines, RawState};

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

/// Line states for a factory: stations in order and terminal from the probe's
/// `lines` query (al-control's line model), each station's bins with
/// workpiece ids from `state`.
pub fn join_lines(state: &RawState, lines: &Lines) -> HashMap<String, LineState> {
    lines
        .lines
        .iter()
        .map(|(code, line)| {
            let bins = line
                .stations
                .iter()
                .map(|st| (st.clone(), state.bins.get(st).cloned().unwrap_or_default()))
                .collect();
            let joined = LineState {
                code: code.clone(),
                stations: line.stations.clone(),
                terminal: line.terminal.clone().unwrap_or_default(),
                bins,
            };
            (code.clone(), joined)
        })
        .collect()
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
    use crate::source::{fixtures::make_factory, Source};

    #[test]
    fn joins_the_probe_line_model_with_bins_and_resolves_positions() {
        let root = make_factory();
        let cfg = crate::central_config::FactoryEntry { name: "f".into(), path: root.display().to_string(), keep: vec![], abs_path: None };
        let host = crate::central_config::HostEntry { name: "local".into(), is_local: true, ssh: None, node: None, factories: vec![] };
        let (_, lines) = Source::for_entry(&host, &cfg).floor().unwrap();
        let vm = &lines["VM"];
        assert_eq!(vm.stations, ["VM1", "VM2"]);
        assert_eq!(vm.terminal, "VM2");

        let pos = resolve_position("wp-2", &lines).unwrap();
        assert_eq!((pos.station.as_str(), pos.bin.as_str(), pos.subpath.as_str(), pos.terminal), ("VM2", "output", "inv/wp-2", true));
        assert_eq!(workpiece_rel_dir(&pos, "wp-2"), "VM2/output/inv/wp-2");
    }
}
