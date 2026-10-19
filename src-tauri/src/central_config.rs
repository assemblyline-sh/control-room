// The al-control config — ~/.assemblyline/al-control/config.yml — is control-room's
// only config. Same file and same validation as al-control's
// src/config.js, so the app and the CLI always agree on hosts, factories and
// keep lists.
//
// Shape:
//   current_host: local
//   hosts:
//     local:
//       factories:
//         factory-acme: ~/factories/factory-acme
//         factory-demo: { path: ~/factories/factory-demo, keep: [DI1/done] }
//     prod:
//       ssh: prod-box
//       node: /home/me/.nvm/versions/node/v22.11.0/bin/node
//       factories: { … }
//
// Edits go through a generic YAML document (not the typed view) so host and
// factory order survive a write. Comments don't — serde_norway drops them,
// the same as al-control's `hosts use`.
//
// control-room never writes `current_host`: the app's selected host is its own
// state, so switching hosts in the window can't retarget the CLI.

use serde::Serialize;
use serde_norway::{Mapping, Value};
use std::path::{Path, PathBuf};

pub const LOCAL_HOST: &str = "local";

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    Io(String),
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FactoryEntry {
    pub name: String,
    /// As written in the config — a path on that host, may start with `~`.
    pub path: String,
    /// `STATION/done|output` bins `clear` must never touch.
    pub keep: Vec<String>,
    /// `path` with `~` expanded. Local host only — a remote `~` is the
    /// remote user's home, which only the remote side can resolve.
    pub abs_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct HostEntry {
    pub name: String,
    pub is_local: bool,
    pub ssh: Option<String>,
    pub node: Option<String>,
    pub factories: Vec<FactoryEntry>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CentralConfig {
    pub path: String,
    pub current_host: Option<String>,
    pub hosts: Vec<HostEntry>,
}

/// `$AL_CONTROL_CONFIG_DIR/config.yml`, else `~/.assemblyline/al-control/config.yml`.
pub fn config_path() -> PathBuf {
    let dir = std::env::var_os("AL_CONTROL_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".assemblyline").join("al-control"));
    dir.join("config.yml")
}

pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

/// `~` and `~/…` against this machine's home; anything else unchanged.
pub fn expand_tilde(p: &str) -> PathBuf {
    if p == "~" {
        home_dir()
    } else if let Some(rest) = p.strip_prefix("~/") {
        home_dir().join(rest)
    } else {
        PathBuf::from(p)
    }
}

/// `/Users/me/x` → `~/x` when under this machine's home — the form
/// al-control's config uses, and readable in the file.
pub fn collapse_tilde(p: &Path) -> String {
    let home = home_dir();
    match p.strip_prefix(&home) {
        Ok(rest) if !home.as_os_str().is_empty() => {
            if rest.as_os_str().is_empty() {
                "~".to_string()
            } else {
                format!("~/{}", rest.display())
            }
        }
        _ => p.display().to_string(),
    }
}

/// `None` when the file doesn't exist yet.
pub fn load() -> Result<Option<CentralConfig>, ConfigError> {
    load_from(&config_path())
}

pub fn load_from(file: &Path) -> Result<Option<CentralConfig>, ConfigError> {
    if !file.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(file).map_err(|e| ConfigError::Io(e.to_string()))?;
    parse(&text, file).map(Some)
}

/// Parse and validate. Rules match al-control's `loadConfig()`.
pub fn parse(text: &str, file: &Path) -> Result<CentralConfig, ConfigError> {
    let shown = file.display();
    let doc: Value = serde_norway::from_str(text)
        .map_err(|e| ConfigError::Invalid(format!("{} is not valid YAML: {}", shown, e)))?;
    let empty = Mapping::new();
    let root = match &doc {
        Value::Mapping(m) => m,
        Value::Null => &empty,
        _ => return Err(ConfigError::Invalid(format!("{} must be a mapping.", shown))),
    };

    let current_host = match root.get("current_host") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => Some(s.clone()),
        Some(_) => return Err(ConfigError::Invalid(format!("current_host in {} must be a string.", shown))),
    };

    let mut hosts = Vec::new();
    let hosts_map = match root.get("hosts") {
        None | Some(Value::Null) => Mapping::new(),
        Some(Value::Mapping(m)) => m.clone(),
        Some(_) => return Err(ConfigError::Invalid(format!("hosts in {} must be a mapping.", shown))),
    };
    for (k, v) in &hosts_map {
        let name = key_string(k, "host", file)?;
        let Value::Mapping(h) = v else {
            return Err(ConfigError::Invalid(format!("Host '{}' in {} must be a mapping.", name, shown)));
        };
        let is_local = name == LOCAL_HOST;
        let ssh = optional_string(h.get("ssh"), &format!("Host '{}' ssh", name), file)?;
        let node = optional_string(h.get("node"), &format!("Host '{}' node", name), file)?;
        if is_local && ssh.is_some() {
            return Err(ConfigError::Invalid(format!(
                "Host 'local' in {} is this machine and must not have an 'ssh' key.",
                shown
            )));
        }
        if !is_local {
            match &ssh {
                None => return Err(ConfigError::Invalid(format!("Host '{}' in {} needs an 'ssh' alias.", name, shown))),
                Some(s) if s.is_empty() => {
                    return Err(ConfigError::Invalid(format!("Host '{}' in {} needs an 'ssh' alias.", name, shown)))
                }
                // A leading dash would be parsed by ssh as an option.
                Some(s) if s.starts_with('-') => {
                    return Err(ConfigError::Invalid(format!("Host '{}' has an invalid ssh alias '{}'.", name, s)))
                }
                _ => {}
            }
        }

        let mut factories = Vec::new();
        match h.get("factories") {
            None | Some(Value::Null) => {}
            Some(Value::Mapping(ws)) => {
                for (wk, wv) in ws {
                    let wname = key_string(wk, "factory", file)?;
                    let (path, keep) = factory_entry(wv).ok_or_else(|| {
                        ConfigError::Invalid(format!(
                            "Factory '{}' on host '{}' in {} must be a path, or {{path, keep: [STATION/done|output, ...]}}.",
                            wname, name, shown
                        ))
                    })?;
                    let abs_path = is_local.then(|| expand_tilde(&path).display().to_string());
                    factories.push(FactoryEntry { name: wname, path, keep, abs_path });
                }
            }
            Some(_) => {
                return Err(ConfigError::Invalid(format!("factories of host '{}' in {} must be a mapping.", name, shown)))
            }
        }
        hosts.push(HostEntry { name, is_local, ssh, node, factories });
    }

    Ok(CentralConfig { path: file.display().to_string(), current_host, hosts })
}

/// A factory value: `path` or `{path, keep}`. `None` when it's neither.
fn factory_entry(v: &Value) -> Option<(String, Vec<String>)> {
    match v {
        Value::String(p) => Some((p.clone(), Vec::new())),
        Value::Mapping(m) => {
            let Some(Value::String(p)) = m.get("path") else { return None };
            let keep = match m.get("keep") {
                None | Some(Value::Null) => Vec::new(),
                Some(Value::Sequence(items)) => {
                    let mut out = Vec::new();
                    for item in items {
                        let Value::String(k) = item else { return None };
                        if !is_keep_entry(k) {
                            return None;
                        }
                        out.push(k.clone());
                    }
                    out
                }
                Some(_) => return None,
            };
            Some((p.clone(), keep))
        }
        _ => None,
    }
}

/// `STATION/done` or `STATION/output`.
fn is_keep_entry(k: &str) -> bool {
    match k.split_once('/') {
        Some((station, bin)) => !station.is_empty() && (bin == "done" || bin == "output"),
        None => false,
    }
}

fn key_string(k: &Value, what: &str, file: &Path) -> Result<String, ConfigError> {
    match k {
        Value::String(s) => Ok(s.clone()),
        _ => Err(ConfigError::Invalid(format!("A {} name in {} is not a string.", what, file.display()))),
    }
}

fn optional_string(v: Option<&Value>, what: &str, file: &Path) -> Result<Option<String>, ConfigError> {
    match v {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(ConfigError::Invalid(format!("{} in {} must be a string.", what, file.display()))),
    }
}

// --------------------------- edits ---------------------------

/// Apply `edit` to the raw document and write it back (mode 0600, as
/// al-control does). The result is re-validated before anything is written.
fn edit_doc(file: &Path, edit: impl FnOnce(&mut Mapping) -> Result<(), ConfigError>) -> Result<CentralConfig, ConfigError> {
    let mut root = if file.exists() {
        let text = std::fs::read_to_string(file).map_err(|e| ConfigError::Io(e.to_string()))?;
        match serde_norway::from_str::<Value>(&text)
            .map_err(|e| ConfigError::Invalid(format!("{} is not valid YAML: {}", file.display(), e)))?
        {
            Value::Mapping(m) => m,
            Value::Null => Mapping::new(),
            _ => return Err(ConfigError::Invalid(format!("{} must be a mapping.", file.display()))),
        }
    } else {
        Mapping::new()
    };
    edit(&mut root)?;

    let text = serde_norway::to_string(&Value::Mapping(root)).map_err(|e| ConfigError::Io(e.to_string()))?;
    let parsed = parse(&text, file)?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| ConfigError::Io(e.to_string()))?;
    }
    write_private(file, &text)?;
    Ok(parsed)
}

#[cfg(unix)]
fn write_private(file: &Path, text: &str) -> Result<(), ConfigError> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(file)
        .map_err(|e| ConfigError::Io(e.to_string()))?;
    f.write_all(text.as_bytes()).map_err(|e| ConfigError::Io(e.to_string()))
}

#[cfg(not(unix))]
fn write_private(file: &Path, text: &str) -> Result<(), ConfigError> {
    std::fs::write(file, text).map_err(|e| ConfigError::Io(e.to_string()))
}

fn hosts_mut(root: &mut Mapping) -> Result<&mut Mapping, ConfigError> {
    let entry = root.entry(Value::from("hosts")).or_insert_with(|| Value::Mapping(Mapping::new()));
    if entry.is_null() {
        *entry = Value::Mapping(Mapping::new());
    }
    entry.as_mapping_mut().ok_or_else(|| ConfigError::Invalid("hosts must be a mapping.".into()))
}

fn factories_mut<'a>(root: &'a mut Mapping, host: &str) -> Result<&'a mut Mapping, ConfigError> {
    let hosts = hosts_mut(root)?;
    let h = hosts
        .get_mut(host)
        .ok_or_else(|| ConfigError::Invalid(format!("No host named '{}'.", host)))?
        .as_mapping_mut()
        .ok_or_else(|| ConfigError::Invalid(format!("Host '{}' must be a mapping.", host)))?;
    let entry = h.entry(Value::from("factories")).or_insert_with(|| Value::Mapping(Mapping::new()));
    if entry.is_null() {
        *entry = Value::Mapping(Mapping::new());
    }
    entry
        .as_mapping_mut()
        .ok_or_else(|| ConfigError::Invalid(format!("factories of host '{}' must be a mapping.", host)))
}

/// Add a factory to a host. `local` is created on first use, so an empty or
/// missing file becomes a valid config with the first factory.
pub fn add_factory(file: &Path, host: &str, name: &str, path: &str) -> Result<CentralConfig, ConfigError> {
    if name.trim().is_empty() {
        return Err(ConfigError::Invalid("Factory name is empty.".into()));
    }
    edit_doc(file, |root| {
        if host == LOCAL_HOST {
            let hosts = hosts_mut(root)?;
            if !hosts.contains_key(LOCAL_HOST) {
                hosts.insert(Value::from(LOCAL_HOST), Value::Mapping(Mapping::new()));
            }
        }
        let factories = factories_mut(root, host)?;
        if factories.contains_key(name) {
            return Err(ConfigError::Invalid(format!("Host '{}' already has a factory named '{}'.", host, name)));
        }
        factories.insert(Value::from(name), Value::from(path));
        Ok(())
    })
}

pub fn remove_factory(file: &Path, host: &str, name: &str) -> Result<CentralConfig, ConfigError> {
    edit_doc(file, |root| {
        let factories = factories_mut(root, host)?;
        if factories.remove(name).is_none() {
            return Err(ConfigError::Invalid(format!("No factory '{}' on host '{}'.", name, host)));
        }
        Ok(())
    })
}

pub fn add_host(file: &Path, name: &str, ssh: &str, node: Option<&str>) -> Result<CentralConfig, ConfigError> {
    if name == LOCAL_HOST {
        return Err(ConfigError::Invalid("'local' is reserved for this machine.".into()));
    }
    edit_doc(file, |root| {
        let hosts = hosts_mut(root)?;
        if hosts.contains_key(name) {
            return Err(ConfigError::Invalid(format!("A host named '{}' already exists.", name)));
        }
        let mut h = Mapping::new();
        h.insert(Value::from("ssh"), Value::from(ssh));
        if let Some(n) = node.filter(|n| !n.is_empty()) {
            h.insert(Value::from("node"), Value::from(n));
        }
        h.insert(Value::from("factories"), Value::Mapping(Mapping::new()));
        hosts.insert(Value::from(name), Value::Mapping(h));
        Ok(())
    })
}

/// A name not yet used on `host`: `base`, else `base-2`, `base-3`, …
pub fn unique_factory_name(cfg: Option<&CentralConfig>, host: &str, base: &str) -> String {
    let taken: Vec<&str> = cfg
        .and_then(|c| c.hosts.iter().find(|h| h.name == host))
        .map(|h| h.factories.iter().map(|w| w.name.as_str()).collect())
        .unwrap_or_default();
    if !taken.contains(&base) {
        return base.to_string();
    }
    (2..).map(|i| format!("{}-{}", base, i)).find(|n| !taken.contains(&n.as_str())).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_file(text: Option<&str>) -> PathBuf {
        // Parallel tests can read the same clock tick; the counter keeps names unique.
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "control-room-cfg-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("config.yml");
        if let Some(t) = text {
            std::fs::write(&file, t).unwrap();
        }
        file
    }

    const VALID: &str = "current_host: local
hosts:
  local:
    factories:
      factory-a: ~/factories/factory-a
      factory-b:
        path: /abs/factory-b
        keep: [DI1/done, VM5/output]
  prod:
    ssh: prod-box
    node: /opt/node/bin/node
    factories:
      factory-c: ~/factories/factory-c
";

    #[test]
    fn missing_file_is_none() {
        assert_eq!(load_from(&tmp_file(None)).unwrap(), None);
    }

    #[test]
    fn parses_hosts_factories_and_keep_in_order() {
        let cfg = load_from(&tmp_file(Some(VALID))).unwrap().unwrap();
        assert_eq!(cfg.current_host.as_deref(), Some("local"));
        assert_eq!(cfg.hosts.iter().map(|h| h.name.as_str()).collect::<Vec<_>>(), ["local", "prod"]);
        let local = &cfg.hosts[0];
        assert!(local.is_local);
        assert_eq!(local.factories[0].path, "~/factories/factory-a");
        assert_eq!(local.factories[0].abs_path.as_deref(), Some(home_dir().join("factories/factory-a").to_str().unwrap()));
        assert_eq!(local.factories[1].keep, ["DI1/done", "VM5/output"]);
        let prod = &cfg.hosts[1];
        assert_eq!(prod.ssh.as_deref(), Some("prod-box"));
        assert_eq!(prod.node.as_deref(), Some("/opt/node/bin/node"));
        assert_eq!(prod.factories[0].abs_path, None);
    }

    #[test]
    fn rejects_what_al_control_rejects() {
        let cases = [
            ("hosts:\n  local:\n    ssh: x\n", "must not have an 'ssh'"),
            ("hosts:\n  prod:\n    factories: {}\n", "needs an 'ssh'"),
            ("hosts:\n  prod:\n    ssh: -oProxyCommand=x\n", "invalid ssh alias"),
            ("hosts:\n  local:\n    factories:\n      b:\n        path: /b\n        keep: [DI1/failed]\n", "must be a path, or"),
            ("hosts:\n  local: nope\n", "must be a mapping"),
        ];
        for (text, msg) in cases {
            let err = load_from(&tmp_file(Some(text))).unwrap_err().to_string();
            assert!(err.contains(msg), "{:?} → {}", text, err);
        }
    }

    #[test]
    fn add_factory_creates_local_and_keeps_order() {
        let file = tmp_file(None);
        add_factory(&file, LOCAL_HOST, "factory-x", "~/w/factory-x").unwrap();
        let cfg = add_factory(&file, LOCAL_HOST, "factory-a", "~/w/factory-a").unwrap();
        assert_eq!(cfg.hosts[0].factories.iter().map(|w| w.name.as_str()).collect::<Vec<_>>(), ["factory-x", "factory-a"]);
        assert!(add_factory(&file, LOCAL_HOST, "factory-a", "~/again").is_err());
    }

    #[test]
    fn edits_keep_long_form_entries_and_other_hosts() {
        let file = tmp_file(Some(VALID));
        add_factory(&file, "prod", "factory-d", "/srv/factory-d").unwrap();
        let cfg = remove_factory(&file, LOCAL_HOST, "factory-a").unwrap();
        assert_eq!(cfg.current_host.as_deref(), Some("local"));
        assert_eq!(cfg.hosts[0].factories[0].keep, ["DI1/done", "VM5/output"]);
        assert_eq!(cfg.hosts[1].factories.iter().map(|w| w.name.as_str()).collect::<Vec<_>>(), ["factory-c", "factory-d"]);
    }

    #[test]
    fn add_host_validates() {
        let file = tmp_file(Some(VALID));
        assert!(add_host(&file, LOCAL_HOST, "x", None).is_err());
        assert!(add_host(&file, "prod", "x", None).is_err());
        assert!(add_host(&file, "edge", "-bad", None).is_err());
        let cfg = add_host(&file, "edge", "edge-box", Some("")).unwrap();
        assert_eq!(cfg.hosts[2].ssh.as_deref(), Some("edge-box"));
        assert_eq!(cfg.hosts[2].node, None);
    }

    #[test]
    fn unique_names() {
        let cfg = load_from(&tmp_file(Some(VALID))).unwrap();
        assert_eq!(unique_factory_name(cfg.as_ref(), LOCAL_HOST, "factory-z"), "factory-z");
        assert_eq!(unique_factory_name(cfg.as_ref(), LOCAL_HOST, "factory-a"), "factory-a-2");
    }

    #[test]
    fn tilde_round_trip() {
        let p = home_dir().join("ec2code/w");
        assert_eq!(collapse_tilde(&p), "~/ec2code/w");
        assert_eq!(expand_tilde("~/ec2code/w"), p);
        assert_eq!(collapse_tilde(Path::new("/elsewhere/w")), "/elsewhere/w");
    }
}

#[cfg(test)]
mod real_config {
    use super::*;

    /// `cargo test -- --ignored real_config` — parse the developer's own
    /// config and round-trip a copy through an edit.
    #[test]
    #[ignore]
    fn parses_and_round_trips_the_real_config() {
        let real = config_path();
        let cfg = load_from(&real).unwrap().expect("no config");
        println!("{:#?}", cfg.hosts.iter().map(|h| (&h.name, h.factories.len())).collect::<Vec<_>>());
        let copy = std::env::temp_dir().join("control-room-real-config-copy.yml");
        std::fs::copy(&real, &copy).unwrap();
        add_factory(&copy, LOCAL_HOST, "zz-test", "~/zz").unwrap();
        let after = remove_factory(&copy, LOCAL_HOST, "zz-test").unwrap();
        assert_eq!(after.hosts, cfg.hosts);
        println!("{}", std::fs::read_to_string(&copy).unwrap());
    }
}
