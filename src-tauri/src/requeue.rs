// Retrying workpieces: move them from a station's `failed` or `done` bin back
// to that same station's `input`. Bin-watch (or the station's cron) picks
// them up from there — lib-factory's watcher fires on a station's own input
// backlog — so there is no run to trigger. Two layers, like clear:
//
//   requeue_workpieces  resolves the ids against fresh state — JS sends ids,
//                       never paths — and refuses anything not there now
//   Source::requeue     re-checks where the move happens (local.rs
//                       requeue_workpieces / the probe's `requeue`)

use serde::Serialize;

use crate::commands::CommandError;
use crate::resolve::resolve;
use crate::source::{RawState, Source};

#[derive(Serialize)]
pub struct RequeueResult {
    pub requeued: usize,
}

/// Move `workpieces` (ids) from `station/bin` to `station/input`. `None`
/// takes the whole bin, which only a `failed` bin allows. All or nothing.
#[tauri::command]
pub async fn requeue_workpieces(
    host: String,
    factory: String,
    station: String,
    bin: String,
    workpieces: Option<Vec<String>>,
) -> Result<RequeueResult, CommandError> {
    let r = resolve(&host, &factory)?;
    let source = Source::for_entry(&r.host, &r.factory);
    let dirs = requeue_dirs(&source.state()?, &station, &bin, workpieces.as_deref())?;
    Ok(RequeueResult { requeued: source.requeue(&dirs)? })
}

/// The dirs (relative to temp/stations/) a requeue moves, from fresh state.
fn requeue_dirs(state: &RawState, station: &str, bin: &str, ids: Option<&[String]>) -> Result<Vec<String>, CommandError> {
    if bin != "failed" && bin != "done" {
        return Err(CommandError::Refused(format!("Only failed and done workpieces can be retried, not {}/{}.", station, bin)));
    }
    if ids.is_none() && bin != "failed" {
        return Err(CommandError::Refused(format!("Retry all is for failed bins only, not {}/{}.", station, bin)));
    }
    let listing = state
        .bins
        .get(station)
        .and_then(|b| b.get(bin))
        .cloned()
        .flatten()
        .ok_or_else(|| CommandError::Refused(format!("{}/{} isn't a bin on a line in this factory.", station, bin)))?;
    let mut dirs: Vec<String> = match ids {
        None => listing.values().map(|sub| format!("{}/{}/{}", station, bin, sub)).collect(),
        Some(ids) => ids
            .iter()
            .map(|id| {
                listing.get(id).map(|sub| format!("{}/{}/{}", station, bin, sub)).ok_or_else(|| {
                    CommandError::Refused(format!("{} isn't in {}/{} any more. Nothing was moved.", id, station, bin))
                })
            })
            .collect::<Result<_, _>>()?,
    };
    dirs.sort();
    Ok(dirs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::local::tests::make_factory;

    fn wp(root: &std::path::Path, rel: &str) {
        let d = root.join("temp/stations").join(rel);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("pointer.json"), "{}").unwrap();
    }

    fn state(root: &std::path::Path) -> RawState {
        Source::Local { root: root.to_path_buf() }.state().unwrap()
    }

    #[test]
    fn resolves_ids_to_dirs_from_fresh_state() {
        let root = make_factory();
        wp(&root, "VM2/failed/wp-3");
        wp(&root, "VM2/failed/inv/wp-4");
        wp(&root, "VM1/done/wp-0");
        let s = state(&root);
        assert_eq!(requeue_dirs(&s, "VM2", "failed", Some(&["wp-4".into()])).unwrap(), ["VM2/failed/inv/wp-4"]);
        assert_eq!(requeue_dirs(&s, "VM2", "failed", None).unwrap(), ["VM2/failed/inv/wp-4", "VM2/failed/wp-3"]);
        assert_eq!(requeue_dirs(&s, "VM1", "done", Some(&["wp-0".into()])).unwrap(), ["VM1/done/wp-0"]);
    }

    #[test]
    fn refuses_other_bins_bulk_done_unknown_ids_and_stations() {
        let root = make_factory();
        wp(&root, "VM1/done/wp-0");
        let s = state(&root);
        let refused = |r: Result<Vec<String>, CommandError>| matches!(r, Err(CommandError::Refused(_)));
        assert!(refused(requeue_dirs(&s, "VM1", "output", Some(&["wp-1".into()]))));
        assert!(refused(requeue_dirs(&s, "VM1", "done", None)));
        assert!(refused(requeue_dirs(&s, "VM1", "done", Some(&["wp-0".into(), "gone".into()]))));
        assert!(refused(requeue_dirs(&s, "X1", "failed", None)), "X1 is on no line");
    }

    #[test]
    fn requeues_through_the_source() {
        let root = make_factory();
        wp(&root, "VM2/failed/wp-3");
        let source = Source::Local { root: root.clone() };
        let dirs = requeue_dirs(&source.state().unwrap(), "VM2", "failed", None).unwrap();
        assert_eq!(source.requeue(&dirs).unwrap(), 1);
        assert_eq!(state(&root).bins["VM2"]["input"].as_ref().unwrap()["wp-3"], "wp-3");
    }
}
