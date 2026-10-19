// Failed workpieces, grouped the way al-control's `workpieces errors` groups
// them. `error_key` is a port of al-control src/utils/failures.js — keep the
// two in parity (the tests below are its test vectors). It's a hand-written
// scanner: there's no regex crate here, and Rust's regex has no lookbehind,
// which the path rule needs so URLs aren't masked.

use serde::Serialize;

use crate::commands::CommandError;
use crate::resolve::resolve_scope;
use crate::source::{ErrorSummary, Source};

const KEY_MAX: usize = 100;
const NO_ERROR: &str = "(no error.json)";

/// Grouping key for a failed workpiece's error: a leading snake_case code,
/// else the message's first line with paths, id-like tokens and 4+ digit
/// numbers masked, capped at KEY_MAX chars.
pub fn error_key(err: Option<&ErrorSummary>) -> String {
    let Some(err) = err else { return NO_ERROR.into() };
    let text = if err.message.is_empty() { err.name.as_deref().unwrap_or("") } else { &err.message };
    let first = text.split('\n').next().unwrap_or("").trim();

    let lead: String = first.chars().take_while(|&c| is_word(c)).collect();
    if is_snake_code(&lead) {
        return lead;
    }

    let masked = mask_numbers(&mask_ids(&mask_paths(first)));
    if masked.chars().count() > KEY_MAX {
        format!("{}…", masked.chars().take(KEY_MAX - 1).collect::<String>())
    } else {
        masked
    }
}

fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// `^[a-z][a-z0-9]*(_[a-z0-9]+)+$`
fn is_snake_code(s: &str) -> bool {
    let mut parts = s.split('_');
    let head = parts.next().unwrap_or("");
    let ok = |p: &str| !p.is_empty() && p.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    head.starts_with(|c: char| c.is_ascii_lowercase()) && ok(head) && s.contains('_') && parts.all(ok)
}

/// `(?<![\w:/])(?:\/[^\s'"`/<>]+)+\/?` → `<path>`
fn mask_paths(s: &str) -> String {
    let c: Vec<char> = s.chars().collect();
    let seg_char = |ch: char| !ch.is_whitespace() && !matches!(ch, '\'' | '"' | '`' | '/' | '<' | '>');
    let mut out = String::new();
    let mut i = 0;
    while i < c.len() {
        let prev_ok = i == 0 || !(is_word(c[i - 1]) || c[i - 1] == ':' || c[i - 1] == '/');
        if c[i] == '/' && prev_ok {
            let mut j = i;
            while j < c.len() && c[j] == '/' && j + 1 < c.len() && seg_char(c[j + 1]) {
                j += 1;
                while j < c.len() && seg_char(c[j]) {
                    j += 1;
                }
            }
            if j > i {
                if j < c.len() && c[j] == '/' {
                    j += 1;
                }
                out.push_str("<path>");
                i = j;
                continue;
            }
        }
        out.push(c[i]);
        i += 1;
    }
    out
}

/// `\b(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{8,}\b` → `<id>`
fn mask_ids(s: &str) -> String {
    let c: Vec<char> = s.chars().collect();
    let idc = |ch: char| is_word(ch) || ch == '-';
    let boundary = |k: usize| {
        let before = k > 0 && is_word(c[k - 1]);
        let after = k < c.len() && is_word(c[k]);
        before != after
    };
    let mut out = String::new();
    let mut i = 0;
    while i < c.len() {
        if idc(c[i]) && boundary(i) {
            let mut e = i;
            while e < c.len() && idc(c[e]) {
                e += 1;
            }
            let run = &c[i..e];
            if run.iter().any(|ch| ch.is_ascii_digit()) && run.iter().any(|ch| ch.is_ascii_alphabetic()) {
                if let Some(k) = (i + 8..=e).rev().find(|&k| boundary(k)) {
                    out.push_str("<id>");
                    i = k;
                    continue;
                }
            }
        }
        out.push(c[i]);
        i += 1;
    }
    out
}

/// `\b\d{4,}\b` → `<n>`
fn mask_numbers(s: &str) -> String {
    let c: Vec<char> = s.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < c.len() {
        if c[i].is_ascii_digit() && (i == 0 || !is_word(c[i - 1])) {
            let mut e = i;
            while e < c.len() && c[e].is_ascii_digit() {
                e += 1;
            }
            if e - i >= 4 && (e == c.len() || !is_word(c[e])) {
                out.push_str("<n>");
                i = e;
                continue;
            }
        }
        out.push(c[i]);
        i += 1;
    }
    out
}

// --------------------------- list_failures ---------------------------

#[derive(Serialize)]
pub struct Failure {
    pub line: String,
    pub station: String,
    pub id: String,
    /// Relative to temp/stations/.
    pub dir: String,
    pub failed_at: Option<String>,
    pub name: Option<String>,
    pub code: Option<serde_json::Value>,
    pub message: Option<String>,
    pub key: String,
    /// No pointer.json: not a workpiece, so there's no workpiece tab to open.
    pub orphan: bool,
}

#[derive(Serialize)]
pub struct FactoryFailures {
    pub factory: String,
    /// The factory couldn't be read; the others still report.
    pub error: Option<String>,
    pub failures: Vec<Failure>,
}

/// Failed workpieces (and orphaned failed folders) with their error keys,
/// for every factory on a host or just `factory`. Two source calls per factory
/// (state, errors).
#[tauri::command]
pub async fn list_failures(host: String, factory: Option<String>) -> Result<Vec<FactoryFailures>, CommandError> {
    let (h, factories) = resolve_scope(&host, factory.as_deref())?;
    Ok(factories
        .iter()
        .map(|w| match factory_failures(&Source::for_entry(&h, w)) {
            Ok(failures) => FactoryFailures { factory: w.name.clone(), error: None, failures },
            Err(e) => FactoryFailures { factory: w.name.clone(), error: Some(e.to_string()), failures: Vec::new() },
        })
        .collect())
}

fn factory_failures(source: &Source) -> Result<Vec<Failure>, CommandError> {
    let (state, lines) = source.floor()?;
    let mut found: Vec<(String, String, String, String, bool)> = Vec::new();
    let mut codes: Vec<&String> = lines.keys().collect();
    codes.sort();
    for code in codes {
        let line = &lines[code];
        for station in &line.stations {
            if let Some(Some(listing)) = line.bins.get(station).and_then(|b| b.get("failed")) {
                for (id, sub) in listing {
                    found.push((code.clone(), station.clone(), id.clone(), format!("{}/failed/{}", station, sub), false));
                }
            }
            for (id, sub) in state.orphans.get(station).into_iter().flatten() {
                found.push((code.clone(), station.clone(), id.clone(), format!("{}/failed/{}", station, sub), true));
            }
        }
    }
    let dirs: Vec<String> = found.iter().map(|f| f.3.clone()).collect();
    let mut errors = source.errors(&dirs)?;
    Ok(found
        .into_iter()
        .map(|(line, station, id, dir, orphan)| {
            let err = errors.remove(&dir).flatten();
            Failure {
                key: error_key(err.as_ref()),
                failed_at: err.as_ref().and_then(|e| e.failed_at.clone()),
                name: err.as_ref().and_then(|e| e.name.clone()),
                code: err.as_ref().and_then(|e| e.code.clone()),
                message: err.map(|e| e.message),
                line,
                station,
                id,
                dir,
                orphan,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(message: &str) -> String {
        error_key(Some(&ErrorSummary { failed_at: None, name: None, code: None, message: message.into() }))
    }

    // al-control tests/failures.test.js
    #[test]
    fn matches_al_control_vectors() {
        assert_eq!(key("gst_state_mismatch: GSTIN is in DL but supply is to MH"), "gst_state_mismatch");
        assert_eq!(
            key("ENOENT: no such file or directory, open '/home/a/temp/TU1/doing/63AGBoa9x5E0-u1788834697/t.json'"),
            "ENOENT: no such file or directory, open '<path>'"
        );
        assert_eq!(key("Row 12345 failed for id aB3dE5gH9k"), "Row <n> failed for id <id>");
        assert_eq!(key("HTTP 500 from https://api.example.com/v1"), "HTTP 500 from https://api.example.com/v1");
        assert_eq!(key("boom\nat line 2"), "boom");
        assert_eq!(error_key(None), "(no error.json)");
        assert_eq!(key(&"word ".repeat(50)).chars().count(), 100);
    }

    #[test]
    fn edge_cases() {
        // Not a code: uppercase, trailing word chars, no underscore.
        assert_eq!(key("Gst_state: x"), "Gst_state: x");
        assert_eq!(key("plain: x"), "plain: x");
        assert_eq!(key("snake_Case: x"), "snake_Case: x");
        // Name when the message is empty.
        let e = ErrorSummary { failed_at: None, name: Some("TimeoutError".into()), code: None, message: String::new() };
        assert_eq!(error_key(Some(&e)), "TimeoutError");
        // Trailing slash folded into the path; ids with trailing hyphens trimmed.
        assert_eq!(key("in /tmp/x/ now"), "in <path> now");
        assert_eq!(key("id abc12345-- end"), "id <id>-- end");
        // Digits glued to letters aren't numbers; 3 digits aren't masked.
        assert_eq!(key("code A1234 and 123"), "code A1234 and 123");
    }

    /// `cargo test -- --ignored error_key_parity --nocapture` — every failed
    /// workpiece on every configured host: Rust's key must equal
    /// al-control's errorKey run with node on the same summaries.
    #[test]
    #[ignore]
    fn error_key_parity() {
        let failures_js = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../cli/al-control/src/utils/failures.js");
        let cfg = crate::central_config::load().unwrap().expect("config");
        let mut summaries = Vec::new();
        for h in &cfg.hosts {
            for w in &h.factories {
                let src = Source::for_entry(h, w);
                let Ok(state) = src.state() else { continue };
                let dirs: Vec<String> = state
                    .bins
                    .iter()
                    .flat_map(|(st, b)| {
                        b.get("failed").and_then(|l| l.as_ref()).into_iter().flatten().map(move |(_, sub)| format!("{}/failed/{}", st, sub))
                    })
                    .chain(state.orphans.iter().flat_map(|(st, o)| o.values().map(move |sub| format!("{}/failed/{}", st, sub))))
                    .collect();
                summaries.extend(src.errors(&dirs).unwrap().into_values());
            }
        }
        let script = format!(
            "import {{ errorKey }} from '{}';\nconst input = {};\nprocess.stdout.write(JSON.stringify(input.map(errorKey)));",
            failures_js,
            serde_json::to_string(&summaries).unwrap()
        );
        let out = std::process::Command::new("node")
            .args(["--input-type=module", "-"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .and_then(|mut c| {
                use std::io::Write;
                c.stdin.take().unwrap().write_all(script.as_bytes())?;
                c.wait_with_output()
            })
            .unwrap();
        let theirs: Vec<String> = serde_json::from_slice(&out.stdout).unwrap();
        let ours: Vec<String> = summaries.iter().map(|s| error_key(s.as_ref())).collect();
        for (i, (a, b)) in ours.iter().zip(&theirs).enumerate() {
            assert_eq!(a, b, "summary {}: {:?}", i, summaries[i]);
        }
        println!("{} error keys identical", ours.len());
    }
}
