//! Migration — legacy on-disk shapes to current.
//!
//! Converts:
//! - config.toml (`[validation]`/`[skills]` → storage-config)
//! - terminology.csv → lexicon.csv (related_terms → aliases)
//! - attractors.csv (valence/phase_state → positive_state/negative_state)

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use std::fs;
use std::path::Path;

use crate::storage::config::StorageConfig;
use crate::storage::format::{self, write_attractors_v3};
use crate::structure::analysis::attractors::Attractor as V3Attractor;
use crate::structure::definition::lexicon::Term as LexiconTerm;

#[derive(Debug, Clone)]
pub struct MigratedV3 {
    pub format_version: String,
    pub storage: StorageConfig,
    pub toml: String,
}

#[derive(Debug, Clone, Default)]
pub struct MigrateReport {
    pub config_migrated: bool,
    pub attractors: usize,
    pub lexicon_terms: usize,
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
        commit_msg_enforce: false,
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

fn is_v3_config(raw: &str) -> bool {
    raw.contains("format_version") || raw.contains("[verification]") || raw.contains("[storage]")
}

fn load_naive_attractors(path: &Path) -> Result<Vec<(String, String, String, String, String)>> {
    // id, name, valence, description, phase_state
    let mut rdr = csv::ReaderBuilder::new().has_headers(true).from_path(path)?;
    let mut rows = Vec::new();
    for rec in rdr.records() {
        let rec = rec?;
        rows.push((
            rec.get(0).unwrap_or("").to_string(),
            rec.get(1).unwrap_or("").to_string(),
            rec.get(2).unwrap_or("").to_string(),
            rec.get(3).unwrap_or("").to_string(),
            rec.get(4).unwrap_or("").to_string(),
        ));
    }
    Ok(rows)
}

fn migrate_attractor_row(
    id: String,
    name: String,
    valence: &str,
    description: String,
    phase_state: String,
) -> V3Attractor {
    let (positive_state, negative_state) = match valence.to_lowercase().as_str() {
        "positive" => {
            let pos = if phase_state.is_empty() {
                description.clone()
            } else {
                phase_state
            };
            let neg = if description.is_empty() {
                format!("(migrated) pressure fails for {name}")
            } else {
                format!("(migrated) pressure fails when: {description}")
            };
            (pos, neg)
        }
        "negative" => {
            let neg = if phase_state.is_empty() {
                description.clone()
            } else {
                phase_state
            };
            let pos = if description.is_empty() {
                format!("(migrated) pressure holds for {name}")
            } else {
                format!("(migrated) pressure holds when opposite of: {description}")
            };
            (pos, neg)
        }
        _ => {
            let pos = if phase_state.is_empty() {
                format!("(migrated) positive state for {name}")
            } else {
                phase_state
            };
            let neg = if description.is_empty() {
                format!("(migrated) negative state for {name}")
            } else {
                description.clone()
            };
            (pos, neg)
        }
    };
    V3Attractor {
        id,
        name,
        description,
        positive_state,
        negative_state,
    }
}

/// Migrate a residual/ directory to current on-disk shape.
pub fn migrate_residual_dir(residual_dir: &Path, force: bool) -> Result<MigrateReport> {
    if !residual_dir.is_dir() {
        bail!("residual dir not found: {}", residual_dir.display());
    }

    let session = crate::storage::integrity::sessions::begin_mutation(residual_dir, force)?;
    let mut report = MigrateReport::default();

    // --- config ---
    let config_path = residual_dir.join("config.toml");
    if config_path.exists() {
        let raw = fs::read_to_string(&config_path)?;
        if !is_v3_config(&raw) {
            let migrated = migrate_naive_to_v3(&raw)?;
            fs::write(&config_path, &migrated.toml)?;
            report.config_migrated = true;
        }
    } else {
        let cfg = StorageConfig::default();
        fs::write(&config_path, crate::storage::config::render_v3(&cfg))?;
        report.config_migrated = true;
    }

    // --- terminology.csv → lexicon.csv ---
    let terminology_path = residual_dir.join("terminology.csv");
    if terminology_path.exists() {
        #[derive(serde::Deserialize)]
        struct OldTerm {
            term: String,
            definition: String,
            domain: String,
            related_terms: String,
        }
        let mut rdr = csv::ReaderBuilder::new()
            .has_headers(true)
            .from_path(&terminology_path)?;
        let mut lexicon: Vec<LexiconTerm> = format::read_lexicon(residual_dir)?;
        let existing_terms: std::collections::HashSet<String> =
            lexicon.iter().map(|t| t.term.clone()).collect();
        let mut added = 0usize;
        for rec in rdr.deserialize() {
            let t: OldTerm = rec?;
            if !existing_terms.contains(&t.term) {
                lexicon.push(LexiconTerm {
                    term: t.term,
                    definition: t.definition,
                    domain: t.domain,
                    aliases: t.related_terms,
                });
                added += 1;
            }
        }
        if added > 0 {
            format::write_lexicon(residual_dir, &lexicon)?;
        }
        fs::remove_file(&terminology_path)?;
        report.lexicon_terms = lexicon.len();
    }

    // --- forces.csv — delete if present (stranded migration artifact) ---
    let forces_path = residual_dir.join("forces.csv");
    if forces_path.exists() {
        fs::remove_file(&forces_path)?;
    }

    // --- stressors.csv — normalize to current column names ---
    let stressors_path = residual_dir.join("stressors.csv");
    if stressors_path.exists() {
        let stressors = crate::storage::stressors::load(residual_dir)?;
        crate::storage::stressors::write_all_pub(residual_dir, &stressors)?;
    }

    // --- purposes.csv — normalize to current column names ---
    let purposes_path = residual_dir.join("purposes.csv");
    if purposes_path.exists() {
        let purposes = crate::storage::purposes::load(residual_dir)?;
        crate::storage::purposes::write_all_pub(residual_dir, &purposes)?;
    }

    // --- attractors valence → +/- states ---
    let attractors_path = residual_dir.join("attractors.csv");
    if attractors_path.exists() {
        let header = {
            let text = fs::read_to_string(&attractors_path)?;
            text.lines().next().unwrap_or("").to_string()
        };
        let v3_attractors = if header.contains("positive_state") {
            format::read_attractors_v3(residual_dir)?
        } else {
            let naive_rows = load_naive_attractors(&attractors_path)?;
            naive_rows
                .into_iter()
                .map(|(id, name, valence, description, phase_state)| {
                    migrate_attractor_row(id, name, &valence, description, phase_state)
                })
                .collect()
        };
        write_attractors_v3(residual_dir, &v3_attractors)?;
        report.attractors = v3_attractors.len();
    }

    session.commit()?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

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

    #[test]
    fn migrate_residual_dir_migrates_terminology_and_attractors() {
        let dir = tempdir().unwrap();
        let residual = dir.path().join("residual");
        fs::create_dir_all(&residual).unwrap();
        fs::write(
            residual.join("config.toml"),
            "[validation]\nstrict = true\n\n[skills]\ntoken_warn = 1000\n",
        )
        .unwrap();
        fs::write(
            residual.join("terminology.csv"),
            "term,definition,domain,related_terms\nresidue,unit of change,core,\nstressor,narrative,core,\n",
        )
        .unwrap();
        fs::write(
            residual.join("attractors.csv"),
            "id,name,valence,description,phase_state\nA-01,Clarity,positive,NKP reflects reality,data is coherent\nA-02,Drift,negative,terms go stale,traits fail\n",
        )
        .unwrap();

        let report = migrate_residual_dir(&residual, true).unwrap();
        assert!(report.config_migrated);
        assert_eq!(report.attractors, 2);
        assert_eq!(report.lexicon_terms, 2);

        let cfg = fs::read_to_string(residual.join("config.toml")).unwrap();
        assert!(cfg.contains("format_version = \"v3\""));

        assert!(!residual.join("terminology.csv").exists(), "terminology.csv should be deleted");

        let lexicon = format::read_lexicon(&residual).unwrap();
        assert_eq!(lexicon.len(), 2);

        let attractors = format::read_attractors_v3(&residual).unwrap();
        assert_eq!(attractors.len(), 2);
        assert!(!attractors[0].positive_state.is_empty());
        let header = fs::read_to_string(residual.join("attractors.csv"))
            .unwrap()
            .lines()
            .next()
            .unwrap()
            .to_string();
        assert!(header.contains("positive_state"));
        assert!(!header.contains("valence"));
    }

    #[test]
    fn migrate_deletes_forces_csv_if_present() {
        let dir = tempdir().unwrap();
        let residual = dir.path().join("residual");
        fs::create_dir_all(&residual).unwrap();
        fs::write(residual.join("config.toml"), "# residual v3 configuration\n[storage]\nformat_version = \"v3\"\n[verification]\n").unwrap();
        fs::write(residual.join("forces.csv"), "id,kind,shortname\nS-01,stressor,foo\n").unwrap();
        let _report = migrate_residual_dir(&residual, true).unwrap();
        assert!(!residual.join("forces.csv").exists(), "forces.csv should be deleted by migrate");
    }

    #[test]
    fn map_component_token_covers_dogfood_aliases() {
        // No longer needed — component mapping was part of the removed forces generation.
        // Kept as a compile-time no-op.
    }
}
