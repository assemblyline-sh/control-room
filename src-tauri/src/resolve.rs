// Turn the (host, factory) pair every command receives into what it acts on.
// JS never passes a path: the config is read here, on every call, the same
// rule as al-control's resolveFactory().

use crate::central_config::{self, HostEntry, FactoryEntry};
use crate::commands::CommandError;

pub struct Resolved {
    pub host: HostEntry,
    pub factory: FactoryEntry,
}

pub fn resolve_host(host: &str) -> Result<HostEntry, CommandError> {
    let cfg = central_config::load()?
        .ok_or_else(|| CommandError::Config(format!("No config at {}.", central_config::config_path().display())))?;
    cfg.hosts
        .into_iter()
        .find(|h| h.name == host)
        .ok_or_else(|| CommandError::Config(format!("No host named '{}' in the config.", host)))
}

/// A host and the factories a host-wide command covers: every one, or just
/// `factory` when given.
pub fn resolve_scope(host: &str, factory: Option<&str>) -> Result<(HostEntry, Vec<FactoryEntry>), CommandError> {
    let h = resolve_host(host)?;
    let factories = match factory {
        Some(name) => vec![resolve(host, name)?.factory],
        None => h.factories.clone(),
    };
    Ok((h, factories))
}

pub fn resolve(host: &str, factory: &str) -> Result<Resolved, CommandError> {
    let h = resolve_host(host)?;
    let w = h
        .factories
        .iter()
        .find(|w| w.name == factory)
        .cloned()
        .ok_or_else(|| CommandError::Config(format!("No factory '{}' on host {}.", factory, host)))?;
    Ok(Resolved { host: h, factory: w })
}

#[cfg(test)]
mod tests {
    use super::*;

    // The only test that sets AL_CONTROL_CONFIG_DIR; everything else in the
    // crate passes explicit paths, so the process-wide env var is safe here.
    #[test]
    fn resolves_hosts_and_factories() {
        let dir = std::env::temp_dir().join(format!("control-room-resolve-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("config.yml"),
            "hosts:\n  local:\n    factories:\n      a: /abs/factory-a\n      b: ~/factory-b\n  prod:\n    ssh: prod-box\n    factories:\n      a: /srv/factory-a\n",
        )
        .unwrap();
        std::env::set_var("AL_CONTROL_CONFIG_DIR", &dir);

        assert_eq!(resolve("local", "a").unwrap().factory.abs_path.as_deref(), Some("/abs/factory-a"));
        let home_b = central_config::home_dir().join("factory-b").display().to_string();
        assert_eq!(resolve("local", "b").unwrap().factory.abs_path, Some(home_b));
        let prod = resolve("prod", "a").unwrap();
        assert_eq!((prod.factory.path.as_str(), prod.factory.abs_path, prod.host.is_local), ("/srv/factory-a", None, false));
        assert!(resolve("local", "nope").err().unwrap().to_string().contains("No factory 'nope'"));
        assert!(resolve("nope", "a").err().unwrap().to_string().contains("No host named 'nope'"));
    }
}
