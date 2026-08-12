//! Migration — naive → v3 only for now.
//! Policy keys migrate into storage-config (no verification-config module).

use anyhow::{Context, Result};
use serde::Deserialize;

use crate::storage::config::StorageConfig;

#[derive(Debug, Clone)]
pub struct MigratedV3 {
    pub format_version: String,
    pub storage: StorageConfig,
    pub toml: String,
}

#[derive(Debug, Deserialize)]
struct NaiveDocument {
    #[serde(default)]
    validation: NaiveValidation,
    #[serde(default)]
    skills: NaiveSkills,
}

#[derive(Debug, Default, Deserialize)]
struct NaiveValidation {
    #[serde(default = "default_true")]
    strict: bool,
}

#[derive(Debug, Default, Deserialize)]
struct NaiveSkills {
    #[serde(default = "default_token_warn")]
    token_warn: usize,
}

fn default_true() -> bool {
    true
}
fn default_token_warn() -> usize {
    1000
}

/// Convert naive config.toml (`[validation]` / `[skills]`) into v3 TOML.
pub fn migrate_naive_to_v3(naive_toml: &str) -> Result<MigratedV3> {
    let naive: NaiveDocument =
        toml::from_str(naive_toml).with_context(|| "parse naive config.toml")?;
    let storage = StorageConfig {
        format_version: "v3".to_string(),
        change_detection: true,
        super_strict: naive.validation.strict,
        token_warn: naive.skills.token_warn,
    };
    let toml_out = crate::storage::config::render_v3(&storage);
    Ok(MigratedV3 {
        format_version: storage.format_version.clone(),
        storage,
        toml: format!(
            "# residual v3 configuration (migrated from naive)\n{}",
            toml_out.trim_start_matches("# residual v3 configuration\n")
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_naive_to_v3() {
        let naive = "[validation]\nstrict = false\n\n[skills]\ntoken_warn = 500\n";
        let v3 = migrate_naive_to_v3(naive).unwrap();
        assert_eq!(v3.format_version, "v3");
        assert!(v3.storage.change_detection);
        assert!(!v3.storage.super_strict);
        assert_eq!(v3.storage.token_warn, 500);
        assert!(v3.toml.contains("format_version = \"v3\""));
        assert!(v3.toml.contains("[storage]"));
        assert!(v3.toml.contains("[verification]"));
        assert!(v3.toml.contains("super_strict = false"));
        assert!(v3.toml.contains("token_warn = 500"));
    }
}
