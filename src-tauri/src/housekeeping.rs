// Clearing done and finished workpieces — al-control's `workpieces clear`
// (docs/decisions/0005 there), at any scope from a whole host down to one
// workpiece. Same rules, in two layers:
//
//   plan_clear        picks: `done` anywhere, a terminal station's `output`;
//                     skips the factory's config `keep` bins and bins a
//                     `lib-factory:move_files` step drains; applies the age filter.
//   clear_workpieces  re-plans from fresh state and refuses any dir that isn't
//                     clearable now — JS input is never trusted — then the
//                     source re-checks on its own where the delete happens
//                     (local.rs remove_workpieces / the probe's `remove`).

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::central_config::FactoryEntry;
use crate::commands::CommandError;
use crate::monitor::{build_lines, LineState};
use crate::resolve::{resolve, resolve_host};
use crate::source::{RawState, Source};

const DAY_MS: f64 = 24.0 * 60.0 * 60.0 * 1000.0;
const CLEARABLE_BINS: [&str; 2] = ["done", "output"];

/// What to clear. A plan takes several, so a mixed selection is one plan.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Scope {
    Host,
    Factory { factory: String },
    Line { factory: String, line: String },
    Bin { factory: String, station: String, bin: String },
    Workpiece { factory: String, station: String, bin: String, workpiece: String },
}

/// `done` / `finished` pick bins for host, factory and line scopes; a bin or
/// workpiece scope names its bin outright. The age filter applies to all.
#[derive(Debug, Clone, Deserialize)]
pub struct Filter {
    pub done: bool,
    pub finished: bool,
    pub older_than_days: Option<f64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Skip {
    /// In the factory's `keep` list in the central config.
    Kept { config: String },
    /// A conveyor step moves this bin's workpieces on.
    Drained { by: String, target: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct BinGroup {
    pub line: String,
    pub station: String,
    pub bin: String,
    /// Workpieces this plan deletes (all of them when skipped: what's there).
    pub count: usize,
    /// Kept back by the age filter.
    pub newer: usize,
    /// Oldest last-activity (ms since epoch) among `dirs`.
    pub oldest: Option<u64>,
    pub skip: Option<Skip>,
    /// Relative to temp/stations/ — what clear_workpieces takes. Empty when skipped.
    pub dirs: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FactoryPlan {
    pub factory: String,
    pub error: Option<String>,
    /// The factory's config entry lists bins to keep.
    pub has_keep_list: bool,
    pub groups: Vec<BinGroup>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClearPlan {
    pub host: String,
    pub factories: Vec<FactoryPlan>,
}

/// What would be cleared, fresh from disk. A factory that can't be read (or a
/// scope that names something unclearable) reports `error`; the rest plan.
#[tauri::command]
pub async fn plan_clear(host: String, scopes: Vec<Scope>, filter: Filter) -> Result<ClearPlan, CommandError> {
    let h = resolve_host(&host)?;
    let all_host = scopes.iter().any(|s| matches!(s, Scope::Host));
    let mut factories = Vec::new();
    for w in &h.factories {
        let mine: Vec<&Scope> = scopes.iter().filter(|s| all_host || scope_factory(s) == Some(&w.name)).collect();
        if mine.is_empty() {
            continue;
        }
        let source = Source::for_entry(&h, w);
        let planned = source.state().and_then(|state| plan_factory(&source, &state, w, &mine, &filter));
        factories.push(match planned {
            Ok(groups) => FactoryPlan { factory: w.name.clone(), error: None, has_keep_list: !w.keep.is_empty(), groups },
            Err(e) => FactoryPlan { factory: w.name.clone(), error: Some(e.to_string()), has_keep_list: !w.keep.is_empty(), groups: Vec::new() },
        });
    }
    if let Some(unknown) = scopes.iter().filter_map(scope_factory).find(|n| !h.factories.iter().any(|w| &w.name == *n)) {
        return Err(CommandError::Config(format!("No factory '{}' on host {}.", unknown, host)));
    }
    Ok(ClearPlan { host, factories })
}

#[derive(Serialize)]
pub struct ClearResult {
    pub removed: usize,
}

/// Delete exactly `dirs` (from a plan) in one factory. Every dir must still be
/// clearable against fresh state, or nothing is deleted.
#[tauri::command]
pub async fn clear_workpieces(host: String, factory: String, dirs: Vec<String>) -> Result<ClearResult, CommandError> {
    let r = resolve(&host, &factory)?;
    Ok(ClearResult { removed: clear_in(&Source::for_entry(&r.host, &r.factory), &r.factory, &dirs)? })
}

fn clear_in(source: &Source, factory: &FactoryEntry, dirs: &[String]) -> Result<usize, CommandError> {
    let allowed = clearable_dirs(&source.state()?, factory);
    if let Some(bad) = dirs.iter().find(|d| !allowed.contains(d.as_str())) {
        return Err(CommandError::Refused(format!(
            "{}: {} isn't clearable (not in a done bin or a terminal output, kept, drained by a conveyor, or gone). Nothing was deleted.",
            factory.name, bad
        )));
    }
    source.remove(dirs, &factory.keep)
}

fn scope_factory(s: &Scope) -> Option<&String> {
    match s {
        Scope::Host => None,
        Scope::Factory { factory } | Scope::Line { factory, .. } | Scope::Bin { factory, .. } | Scope::Workpiece { factory, .. } => {
            Some(factory)
        }
    }
}

/// `STATION/BIN` → (station whose step drains it, where to), for every bin a
/// `lib-factory:move_files` conveyor drains. The step takes one move
/// (`source_bin`, `target_bin`) or a `moves` array of them, as al-control's
/// `src/utils/conveyors.js`. A source_bin may name a sub-bin; it's matched on
/// its first two segments.
fn drained_bins(state: &RawState) -> HashMap<String, (String, String)> {
    let mut out = HashMap::new();
    for s in &state.stations {
        let owner = s.data.get("short_code").or_else(|| s.data.get("id")).and_then(|v| v.as_str()).unwrap_or("?");
        for step in s.data.get("steps").and_then(|v| v.as_array()).into_iter().flatten() {
            if step.get("slug").and_then(|v| v.as_str()) != Some("lib-factory:move_files") {
                continue;
            }
            let Some(config) = step.get("config") else { continue };
            let moves = match config.get("moves").and_then(|v| v.as_array()) {
                Some(moves) => moves.iter().collect::<Vec<_>>(),
                None => vec![config],
            };
            for m in moves {
                let Some(source_bin) = m.get("source_bin").and_then(|v| v.as_str()) else { continue };
                let key = source_bin.split('/').take(2).collect::<Vec<_>>().join("/");
                let target = m.get("target_bin").and_then(|v| v.as_str()).unwrap_or("?");
                out.insert(key, (owner.to_string(), target.to_string()));
            }
        }
    }
    out
}

fn skip_for(spec: &str, factory: &FactoryEntry, drained: &HashMap<String, (String, String)>) -> Option<Skip> {
    if factory.keep.iter().any(|k| k == spec) {
        return Some(Skip::Kept { config: crate::central_config::config_path().display().to_string() });
    }
    drained.get(spec).map(|(by, target)| Skip::Drained { by: by.clone(), target: target.clone() })
}

/// The line's clearable bins in station order: `done` everywhere, `output`
/// on the terminal station.
fn clearable_bins(line: &LineState) -> Vec<(String, &'static str)> {
    let mut out = Vec::new();
    for station in &line.stations {
        for bin in CLEARABLE_BINS {
            if bin == "done" || station == &line.terminal {
                out.push((station.clone(), bin));
            }
        }
    }
    out
}

/// Every dir clear_workpieces may delete in this factory right now.
fn clearable_dirs(state: &RawState, factory: &FactoryEntry) -> HashSet<String> {
    let drained = drained_bins(state);
    let mut out = HashSet::new();
    for line in build_lines(state).values() {
        for (station, bin) in clearable_bins(line) {
            let spec = format!("{}/{}", station, bin);
            if skip_for(&spec, factory, &drained).is_some() {
                continue;
            }
            if let Some(Some(listing)) = line.bins.get(&station).and_then(|b| b.get(bin)) {
                out.extend(listing.values().map(|sub| format!("{}/{}", spec, sub)));
            }
        }
    }
    out
}

fn plan_factory(
    source: &Source,
    state: &RawState,
    factory: &FactoryEntry,
    scopes: &[&Scope],
    filter: &Filter,
) -> Result<Vec<BinGroup>, CommandError> {
    let lines = build_lines(state);
    let drained = drained_bins(state);
    let wants_bin = |bin: &str| if bin == "done" { filter.done } else { filter.finished };

    // (station, bin) → None = every workpiece, Some(ids) = just those.
    let mut selected: HashMap<(String, String), Option<HashSet<String>>> = HashMap::new();
    let mut select = |station: &str, bin: &str, id: Option<&str>| {
        let entry = selected.entry((station.to_string(), bin.to_string())).or_insert_with(|| Some(HashSet::new()));
        match (entry.as_mut(), id) {
            (Some(ids), Some(id)) => {
                ids.insert(id.to_string());
            }
            _ => *entry = None,
        }
    };
    for scope in scopes {
        match scope {
            Scope::Host | Scope::Factory { .. } => {
                for line in lines.values() {
                    for (station, bin) in clearable_bins(line).into_iter().filter(|(_, b)| wants_bin(b)) {
                        select(&station, bin, None);
                    }
                }
            }
            Scope::Line { line, .. } => {
                let l = lines.get(line).ok_or_else(|| CommandError::Io(format!("line not found: {}", line)))?;
                for (station, bin) in clearable_bins(l).into_iter().filter(|(_, b)| wants_bin(b)) {
                    select(&station, bin, None);
                }
            }
            Scope::Bin { station, bin, .. } | Scope::Workpiece { station, bin, .. } => {
                let line = lines
                    .values()
                    .find(|l| l.stations.contains(station))
                    .ok_or_else(|| CommandError::Io(format!("station not found: {}", station)))?;
                if !clearable_bins(line).iter().any(|(s, b)| s == station && b == bin) {
                    return Err(CommandError::Refused(format!(
                        "{}/{} can't be cleared: only done bins and a line's terminal output (here {}/output).",
                        station, bin, line.terminal
                    )));
                }
                let id = match scope {
                    Scope::Workpiece { workpiece, .. } => Some(workpiece.as_str()),
                    _ => None,
                };
                select(station, bin, id);
            }
        }
    }

    // Lines alphabetically, stations in line order, done before output.
    let mut groups = Vec::new();
    let ordered: BTreeMap<&String, &LineState> = lines.iter().collect();
    for (code, line) in ordered {
        for (station, bin) in clearable_bins(line) {
            let Some(ids) = selected.get(&(station.clone(), bin.to_string())) else { continue };
            let listing = line.bins.get(&station).and_then(|b| b.get(bin)).cloned().flatten().unwrap_or_default();
            let spec = format!("{}/{}", station, bin);
            let mut dirs: Vec<String> = listing
                .iter()
                .filter(|(id, _)| ids.as_ref().map_or(true, |set| set.contains(*id)))
                .map(|(_, sub)| format!("{}/{}", spec, sub))
                .collect();
            dirs.sort();
            if dirs.is_empty() {
                continue;
            }
            let skip = skip_for(&spec, factory, &drained);
            groups.push(BinGroup {
                line: code.clone(),
                station: station.clone(),
                bin: bin.to_string(),
                count: dirs.len(),
                newer: 0,
                oldest: None,
                dirs: if skip.is_some() { Vec::new() } else { dirs },
                skip,
            });
        }
    }

    // Ages for everything that would be deleted — one source call.
    let all: Vec<String> = groups.iter().flat_map(|g| g.dirs.iter().cloned()).collect();
    let ages = source.ages(&all)?;
    let cutoff = filter.older_than_days.map(|d| now_ms() - d * DAY_MS);
    for g in groups.iter_mut().filter(|g| g.skip.is_none()) {
        let before = g.dirs.len();
        if let Some(cutoff) = cutoff {
            g.dirs.retain(|d| ages.get(d).copied().flatten().is_some_and(|a| (a as f64) < cutoff));
        }
        g.count = g.dirs.len();
        g.newer = before - g.count;
        g.oldest = g.dirs.iter().filter_map(|d| ages.get(d).copied().flatten()).min();
    }
    groups.retain(|g| g.count > 0 || g.newer > 0);
    Ok(groups)
}

fn now_ms() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::local::tests::make_factory;

    fn entry(root: &std::path::Path, keep: &[&str]) -> FactoryEntry {
        FactoryEntry {
            name: "w".into(),
            path: root.display().to_string(),
            keep: keep.iter().map(|s| s.to_string()).collect(),
            abs_path: Some(root.display().to_string()),
        }
    }

    fn wp(root: &std::path::Path, rel: &str) {
        let d = root.join("temp/stations").join(rel);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("pointer.json"), "{}").unwrap();
    }

    const BOTH: Filter = Filter { done: true, finished: true, older_than_days: None };

    fn plan(root: &std::path::Path, w: &FactoryEntry, scopes: &[Scope], filter: &Filter) -> Vec<BinGroup> {
        let source = Source::Local { root: root.to_path_buf() };
        let state = source.state().unwrap();
        plan_factory(&source, &state, w, &scopes.iter().collect::<Vec<_>>(), filter).unwrap()
    }

    // make_factory: VM1 → VM2 (terminal); VM1/output/wp-1, VM2/output/inv/wp-2.
    #[test]
    fn picks_done_and_terminal_output_only() {
        let root = make_factory();
        wp(&root, "VM1/done/wp-0");
        wp(&root, "VM2/failed/wp-9");
        let w = entry(&root, &[]);
        let g = plan(&root, &w, &[Scope::Host], &BOTH);
        let specs: Vec<String> = g.iter().map(|g| format!("{}/{} {}", g.station, g.bin, g.count)).collect();
        assert_eq!(specs, vec!["VM1/done 1", "VM2/output 1"]);
        assert_eq!(g[1].dirs, vec!["VM2/output/inv/wp-2"]);
        let only_done = plan(&root, &w, &[Scope::Host], &Filter { done: true, finished: false, older_than_days: None });
        assert_eq!(only_done.len(), 1);
    }

    #[test]
    fn kept_and_drained_bins_are_skipped_and_refused() {
        let root = make_factory();
        wp(&root, "VM1/done/wp-0");
        std::fs::write(
            root.join(".orchestrator/stations/VM1__a.json"),
            r#"{"id":"id1","short_code":"VM1","line":"VM","dependencies":[],"steps":[{"slug":"lib-factory:move_files","config":{"source_bin":"VM2/output/inv","target_bin":"X1/input"}}]}"#,
        )
        .unwrap();
        let w = entry(&root, &["VM1/done"]);
        let g = plan(&root, &w, &[Scope::Host], &BOTH);
        assert!(matches!(g[0].skip, Some(Skip::Kept { .. })) && g[0].dirs.is_empty() && g[0].count == 1);
        assert_eq!(g[1].skip, Some(Skip::Drained { by: "VM1".into(), target: "X1/input".into() }));

        let source = Source::Local { root: root.clone() };
        let allowed = clearable_dirs(&source.state().unwrap(), &w);
        assert!(allowed.is_empty());
    }

    #[test]
    fn every_bin_in_a_moves_array_is_drained() {
        let root = make_factory();
        std::fs::write(
            root.join(".orchestrator/stations/VM1__a.json"),
            r#"{"id":"id1","short_code":"VM1","line":"VM","dependencies":[],"steps":[{"slug":"lib-factory:move_files","config":{"moves":[{"source_bin":"VM2/output","target_bin":"X1/input"},{"source_bin":"VM1/done/ok","target_bin":"X2/input"}]}}]}"#,
        )
        .unwrap();
        let drained = drained_bins(&Source::Local { root: root.clone() }.state().unwrap());
        assert_eq!(drained.get("VM2/output"), Some(&("VM1".to_string(), "X1/input".to_string())));
        assert_eq!(drained.get("VM1/done"), Some(&("VM1".to_string(), "X2/input".to_string())));
    }

    #[test]
    fn bin_and_workpiece_scopes() {
        let root = make_factory();
        wp(&root, "VM1/done/wp-0");
        wp(&root, "VM1/done/wp-5");
        let w = entry(&root, &[]);
        let one = Scope::Workpiece { factory: "w".into(), station: "VM1".into(), bin: "done".into(), workpiece: "wp-5".into() };
        let g = plan(&root, &w, &[one], &BOTH);
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].dirs, vec!["VM1/done/wp-5"]);

        // A bin scope widens a workpiece scope in the same bin.
        let one = Scope::Workpiece { factory: "w".into(), station: "VM1".into(), bin: "done".into(), workpiece: "wp-5".into() };
        let bin = Scope::Bin { factory: "w".into(), station: "VM1".into(), bin: "done".into() };
        assert_eq!(plan(&root, &w, &[one, bin], &BOTH)[0].count, 2);

        // Non-terminal output is refused.
        let source = Source::Local { root: root.clone() };
        let state = source.state().unwrap();
        let bad = Scope::Bin { factory: "w".into(), station: "VM1".into(), bin: "output".into() };
        assert!(matches!(plan_factory(&source, &state, &w, &[&bad], &BOTH), Err(CommandError::Refused(_))));
    }

    #[test]
    fn age_filter_keeps_recent_folders() {
        let root = make_factory();
        wp(&root, "VM1/done/old");
        wp(&root, "VM1/done/new");
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(40 * 86400);
        std::fs::File::open(root.join("temp/stations/VM1/done/old")).unwrap().set_modified(old).unwrap();
        let w = entry(&root, &[]);
        let g = plan(&root, &w, &[Scope::Host], &Filter { done: true, finished: false, older_than_days: Some(30.0) });
        assert_eq!((g[0].count, g[0].newer), (1, 1));
        assert_eq!(g[0].dirs, vec!["VM1/done/old"]);
        assert!(g[0].oldest.unwrap() < now_ms() as u64 - 39 * 86_400_000);
    }

    #[test]
    fn clear_refuses_whole_batches_and_deletes_exact_dirs() {
        let root = make_factory();
        wp(&root, "VM1/done/a");
        wp(&root, "VM1/done/b");
        wp(&root, "VM2/failed/f");
        let source = Source::Local { root: root.clone() };
        let st = |rel: &str| root.join("temp/stations").join(rel);

        // Each bad dir refuses the batch it's in, and nothing in it is deleted.
        let kept = entry(&root, &["VM1/done"]);
        for (w, bad) in [
            (entry(&root, &[]), "VM2/failed/f"),
            (entry(&root, &[]), "VM1/output/wp-1"), // not terminal
            (entry(&root, &[]), "VM1/done/gone"),
            (entry(&root, &[]), "VM1/done/../../VM2/failed/f"),
            (kept, "VM1/done/a"),
        ] {
            let r = clear_in(&source, &w, &["VM2/output/inv/wp-2".into(), bad.into()]);
            assert!(matches!(r, Err(CommandError::Refused(_))), "{} should be refused", bad);
            assert!(st("VM2/output/inv/wp-2").exists() && st("VM1/done/a").exists() && st("VM2/failed/f").exists());
        }

        // Valid: exactly those dirs go; a sub-bin stays.
        let w = entry(&root, &[]);
        assert_eq!(clear_in(&source, &w, &["VM1/done/a".into(), "VM2/output/inv/wp-2".into()]).unwrap(), 2);
        assert!(!st("VM1/done/a").exists() && st("VM1/done/b").exists());
        assert!(!st("VM2/output/inv/wp-2").exists() && st("VM2/output/inv").exists());
    }

    #[test]
    fn clearable_dirs_excludes_failed_and_non_terminal_output() {
        let root = make_factory();
        wp(&root, "VM1/done/wp-0");
        wp(&root, "VM2/failed/wp-9");
        let w = entry(&root, &[]);
        let source = Source::Local { root: root.clone() };
        let mut allowed: Vec<String> = clearable_dirs(&source.state().unwrap(), &w).into_iter().collect();
        allowed.sort();
        assert_eq!(allowed, vec!["VM1/done/wp-0", "VM2/output/inv/wp-2"]);
        assert_eq!(source.remove(&["VM1/done/wp-0".into()], &[]).unwrap(), 1);
        assert!(matches!(source.remove(&["VM2/failed/wp-9".into()], &[]), Err(CommandError::Refused(_))));
        assert!(root.join("temp/stations/VM2/failed/wp-9").exists());
    }
}

#[cfg(test)]
mod real {
    use super::*;

    /// `cargo test -- --ignored plan_every_host --nocapture` — the plan for
    /// every configured host (read-only), to compare with
    /// `al-control workpieces clear --bin done|finished -w <factory>` dry runs.
    #[test]
    #[ignore]
    fn plan_every_host() {
        let cfg = crate::central_config::load().unwrap().expect("config");
        for h in &cfg.hosts {
            for (label, filter) in [
                ("done", Filter { done: true, finished: false, older_than_days: None }),
                ("finished", Filter { done: false, finished: true, older_than_days: None }),
            ] {
                let started = std::time::Instant::now();
                let rt = tauri::async_runtime::block_on(plan_clear(h.name.clone(), vec![Scope::Host], filter)).unwrap();
                for w in rt.factories {
                    let del: usize = w.groups.iter().filter(|g| g.skip.is_none()).map(|g| g.count).sum();
                    let skipped: Vec<String> =
                        w.groups.iter().filter(|g| g.skip.is_some()).map(|g| format!("{}/{}", g.station, g.bin)).collect();
                    println!("{}/{:<18} {:<8} would delete {:>6}  skipped {:?} {}", h.name, w.factory, label, del, skipped, w.error.unwrap_or_default());
                }
                println!("  ({:?})", started.elapsed());
            }
        }
    }
}

#[cfg(test)]
mod remote_scratch {
    use super::*;

    /// `CR_SCRATCH_HOST=<host> cargo test -- --ignored remote_clear_scratch --nocapture`
    /// — builds a throwaway factory under /tmp on that host, clears through the
    /// SSH source (the probe's `remove`), checks what's left, deletes the
    /// scratch dir. Touches no real factory.
    #[test]
    #[ignore]
    fn remote_clear_scratch() {
        let host_name = std::env::var("CR_SCRATCH_HOST").expect("CR_SCRATCH_HOST");
        let host = resolve_host(&host_name).unwrap();
        let dir = format!("/tmp/control-room-scratch-{}", std::process::id());
        let ssh = |script: &str| -> String {
            let out = std::process::Command::new("ssh")
                .args(["-o", "BatchMode=yes", host.ssh.as_deref().unwrap(), script])
                .output()
                .unwrap();
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };
        ssh(&format!(
            "set -e; d={d}; mkdir -p $d/.orchestrator/stations $d/.orchestrator/lines; \
             echo '{{\"id\":\"i1\",\"short_code\":\"S1\",\"line\":\"L\",\"dependencies\":[]}}' > $d/.orchestrator/stations/S1.json; \
             echo '{{\"id\":\"i2\",\"short_code\":\"S2\",\"line\":\"L\",\"dependencies\":[\"i1\"]}}' > $d/.orchestrator/stations/S2.json; \
             for w in S1/done/a S1/done/b S2/output/x S2/failed/f; do mkdir -p $d/temp/stations/$w; echo {{}} > $d/temp/stations/$w/pointer.json; done",
            d = dir
        ));
        let factory = FactoryEntry { name: "scratch".into(), path: dir.clone(), keep: vec![], abs_path: None };
        let source = Source::for_entry(&host, &factory);

        let plan = plan_factory(&source, &source.state().unwrap(), &factory, &[&Scope::Host], &Filter { done: true, finished: true, older_than_days: None }).unwrap();
        println!("plan: {:?}", plan.iter().map(|g| (g.station.as_str(), g.bin.as_str(), g.count)).collect::<Vec<_>>());

        let refused = clear_in(&source, &factory, &["S1/done/a".into(), "S2/failed/f".into()]);
        println!("refused: {:?}", refused.as_ref().err().map(|e| e.to_string()));
        assert!(matches!(refused, Err(CommandError::Refused(_))));
        let kept = FactoryEntry { keep: vec!["S1/done".into()], ..factory.clone() };
        assert!(matches!(clear_in(&source, &kept, &["S1/done/a".into()]), Err(CommandError::Refused(_))));

        assert_eq!(clear_in(&source, &factory, &["S1/done/a".into(), "S2/output/x".into()]).unwrap(), 2);
        let left = ssh(&format!("cd {}/temp/stations && find . -name pointer.json | sort | tr '\\n' ' '", dir));
        println!("left: {}", left);
        assert_eq!(left, "./S1/done/b/pointer.json ./S2/failed/f/pointer.json");
        ssh(&format!("rm -rf {}", dir));
    }
}
