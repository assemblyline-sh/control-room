// `CR_UI_FIXTURES=<file> cargo test -- --ignored dump_ui_fixtures` — runs
// the real read commands against the local host and writes their answers,
// keyed `cmd|args-json`, for rendering the UI in a plain browser with a
// mocked `invoke` (no Tauri window needed). Read-only.

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};
    use std::collections::BTreeMap;

    use crate::housekeeping::{plan_clear, Filter, Scope};
    use crate::{commands, failures, monitor_commands as mc, pm2};

    fn put<T: serde::Serialize, E: std::fmt::Display>(out: &mut BTreeMap<String, Value>, cmd: &str, args: Value, r: Result<T, E>) {
        let v = match r {
            Ok(v) => json!({ "ok": serde_json::to_value(v).unwrap() }),
            Err(e) => json!({ "err": e.to_string() }),
        };
        out.insert(format!("{}|{}", cmd, args), v);
    }

    #[test]
    #[ignore]
    fn dump_ui_fixtures() {
        let path = std::env::var("CR_UI_FIXTURES").expect("CR_UI_FIXTURES");
        let mut out = BTreeMap::new();
        put(&mut out, "load_config", json!({}), tauri::async_runtime::block_on(commands::load_config()));
        put(&mut out, "check_pm2_available", json!({}), tauri::async_runtime::block_on(pm2::check_pm2_available()));
        let h = "local".to_string();
        put(&mut out, "host_counts", json!({ "host": h }), tauri::async_runtime::block_on(mc::host_counts(h.clone())));
        put(&mut out, "list_failures", json!({ "host": h, "factory": null }), tauri::async_runtime::block_on(failures::list_failures(h.clone(), None)));
        for (done, finished) in [(true, true), (true, false), (false, true)] {
            for days in [None, Some(30.0)] {
                let f = Filter { done, finished, older_than_days: days };
                put(&mut out, "plan_clear", json!({ "host": h, "scopes": [{ "kind": "host" }], "filter": { "done": done, "finished": finished, "older_than_days": days } }), tauri::async_runtime::block_on(plan_clear(h.clone(), vec![Scope::Host], f)));
            }
        }
        let cfg = crate::central_config::load().unwrap().unwrap();
        let local = cfg.hosts.iter().find(|x| x.is_local).unwrap();
        for w in &local.factories {
            let wn = w.name.clone();
            let a = json!({ "host": h, "factory": wn });
            put(&mut out, "list_lines", a.clone(), tauri::async_runtime::block_on(mc::list_lines(h.clone(), wn.clone())));
            put(&mut out, "factory_orchestrator", a.clone(), tauri::async_runtime::block_on(mc::factory_orchestrator(h.clone(), wn.clone())));
            put(&mut out, "factory_status", a.clone(), tauri::async_runtime::block_on(pm2::factory_status(h.clone(), wn.clone())));
            put(&mut out, "list_failures", a.clone(), tauri::async_runtime::block_on(failures::list_failures(h.clone(), Some(wn.clone()))));
            for kind_done in [(true, false), (false, true), (true, true)] {
                let scope = json!([{ "kind": "factory", "factory": wn }]);
                let filter = json!({ "done": kind_done.0, "finished": kind_done.1, "older_than_days": null });
                put(&mut out, "plan_clear", json!({ "host": h, "scopes": scope, "filter": filter }), tauri::async_runtime::block_on(plan_clear(h.clone(), vec![Scope::Factory { factory: wn.clone() }], Filter { done: kind_done.0, finished: kind_done.1, older_than_days: None })));
            }
            let Ok(lines) = tauri::async_runtime::block_on(mc::list_lines(h.clone(), wn.clone())) else { continue };
            for l in lines {
                for (d, f) in [(true, false), (false, true), (true, true)] {
                    put(
                        &mut out,
                        "plan_clear",
                        json!({ "host": h, "scopes": [{ "kind": "line", "factory": wn, "line": l.code }], "filter": { "done": d, "finished": f, "older_than_days": null } }),
                        tauri::async_runtime::block_on(plan_clear(h.clone(), vec![Scope::Line { factory: wn.clone(), line: l.code.clone() }], Filter { done: d, finished: f, older_than_days: None })),
                    );
                }
                put(&mut out, "show_line", json!({ "host": h, "factory": wn, "line": l.code }), tauri::async_runtime::block_on(mc::show_line(h.clone(), wn.clone(), l.code.clone())));
                for st in &l.stations {
                    put(&mut out, "show_station", json!({ "host": h, "factory": wn, "line": l.code, "station": st }), tauri::async_runtime::block_on(mc::show_station(h.clone(), wn.clone(), l.code.clone(), st.clone())));
                    for bin in ["input", "doing", "output", "failed", "done"] {
                        let r = tauri::async_runtime::block_on(mc::list_bin_workpieces(h.clone(), wn.clone(), st.clone(), bin.into()));
                        if bin == "failed" || bin == "done" || bin == "output" {
                            if let Ok(rows) = &r {
                                for row in rows.iter().take(3) {
                                    put(&mut out, "show_workpiece", json!({ "host": h, "factory": wn, "workpieceId": row.id }), tauri::async_runtime::block_on(mc::show_workpiece(h.clone(), wn.clone(), row.id.clone())));
                                }
                            }
                        }
                        put(&mut out, "list_bin_workpieces", json!({ "host": h, "factory": wn, "station": st, "bin": bin }), r);
                        let scope = json!([{ "kind": "bin", "factory": wn, "station": st, "bin": bin }]);
                        let filter = json!({ "done": true, "finished": true, "older_than_days": null });
                        put(&mut out, "plan_clear", json!({ "host": h, "scopes": scope, "filter": filter }), tauri::async_runtime::block_on(plan_clear(h.clone(), vec![Scope::Bin { factory: wn.clone(), station: st.clone(), bin: bin.into() }], Filter { done: true, finished: true, older_than_days: None })));
                    }
                }
            }
        }
        std::fs::write(&path, serde_json::to_string(&out).unwrap()).unwrap();
        println!("{} fixtures → {}", out.len(), path);
    }
}
