//! Migration — naive → v3 only for now.
//!
//! Converts:
//! - config.toml (`[validation]`/`[skills]` → v3 storage-config)
//! - stressors.csv + purposes.csv → forces.csv + residues.csv
//! - attractors.csv (valence/phase_state → positive_state/negative_state)
//! - terminology.csv → lexicon.csv (related_terms → aliases)
//!
//! Legacy stressors/purposes/terminology CSVs are left in place so mid-transition
//! readers (matrix, trait verify) keep working; v3 artifacts are authoritative
//! for Force / Residue / Attractor / lexicon continuity.

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use std::fs;
use std::path::Path;

use crate::storage::config::StorageConfig;
use crate::storage::format::{self, write_attractors_v3, write_residues};
use crate::structure::analysis::attractors::Attractor as V3Attractor;
use crate::structure::analysis::force::{Force, ForceKind};
use crate::structure::analysis::residues::Residue;
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
    pub forces: usize,
    pub residues: usize,
    pub attractors: usize,
    pub lexicon_terms: usize,
    pub unmapped_components: Vec<String>,
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

fn is_v3_config(raw: &str) -> bool {
    raw.contains("format_version") || raw.contains("[verification]") || raw.contains("[storage]")
}

/// Best-effort map from naive dogfood component tokens → fully-qualified registry names.
fn map_component_token(token: &str) -> Option<String> {
    let mapped = match token {
        "research-study" => "research-study",
        "cli" | "cli-add" | "cli-init" => "cli",
        "cli-help" => "cli-help",
        "personas" => "skills-personas",
        "stressor-walk" | "context-builder" | "skill-interface" | "skill-data" | "skill-list"
        | "skill-show" => "skills-phases",
        "skill-install" | "skill-check" | "install-paths" => "skills-installer",
        "verify-traits" | "verify-links" | "verify-all" => "verification",
        "git-hook" => "verification-git-hook",
        "tag-scan" => "structure-analysis-tag-scan",
        "stressor-schema" | "storage-stressors" => "structure-analysis-stressors",
        "storage-purposes" => "structure-analysis-purposes",
        "storage-attractors" => "structure-analysis-attractors",
        "residues-csv" => "structure-analysis-residues",
        "nkp-matrix" | "matrix-show" | "matrix-criticality" | "matrix-ri" | "group-filter" => {
            "structure-analysis"
        }
        "terminology" => "structure-definition-lexicon",
        "components-registry" => "structure-definition-components",
        "storage-init" | "storage-append" | "storage-io" => "storage",
        "file-locking" | "change-detection" => "storage-sessions",
        "storage-config" => "storage-config",
        "storage-format" => "storage-format",
        "storage-migration" => "storage-migration",
        "skills-personas" | "skills-research" | "skills-phases" | "skills-installer"
        | "verification" | "verification-git-hook" | "structure" | "structure-analysis"
        | "structure-analysis-tag-scan" | "structure-analysis-force"
        | "structure-analysis-purposes" | "structure-analysis-stressors"
        | "structure-analysis-attractors" | "structure-analysis-residues"
        | "structure-definition-lexicon" | "structure-definition-components"
        | "structure-definition-iterations" | "storage" | "storage-sessions" => token,
        _ => return None,
    };
    Some(mapped.to_string())
}

fn split_component_field(raw: &str) -> Vec<String> {
    raw.split(|c: char| c == ',' || c.is_whitespace())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

fn split_outcomes(traits: &str, fallback: &str) -> Vec<String> {
    let mut out: Vec<String> = traits
        .split('|')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    if out.is_empty() && !fallback.trim().is_empty() {
        out.push(fallback.trim().to_string());
    }
    out
}

fn shortname_for(id: &str, haystacks: &[&str], terms: &[String]) -> String {
    let blob = haystacks.join(" ").to_lowercase();
    for term in terms {
        let t = term.to_lowercase();
        if !t.is_empty() && blob.contains(&t) {
            return format!("{}-{}", t.replace(' ', "-"), id.to_lowercase());
        }
    }
    format!("residue-{}", id.to_lowercase())
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
            // Already v3-ish or unknown — treat phase_state as positive, description aids negative.
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

/// Migrate a residual/ directory from naive on-disk shape to v3 artifacts.
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
        if is_v3_config(&raw) && !force {
            // Already v3 config; leave as-is unless forcing a rewrite from naive isn't possible.
            report.config_migrated = false;
        } else if is_v3_config(&raw) {
            report.config_migrated = false;
        } else {
            let migrated = migrate_naive_to_v3(&raw)?;
            fs::write(&config_path, &migrated.toml)?;
            report.config_migrated = true;
        }
    } else {
        let cfg = StorageConfig::default();
        fs::write(&config_path, crate::storage::config::render_v3(&cfg))?;
        report.config_migrated = true;
    }

    // --- terminology → lexicon ---
    let terms_naive = crate::storage::terminology::load(residual_dir)?;
    let term_names: Vec<String> = terms_naive.iter().map(|t| t.term.clone()).collect();
    let lexicon: Vec<LexiconTerm> = terms_naive
        .iter()
        .map(|t| LexiconTerm {
            term: t.term.clone(),
            definition: t.definition.clone(),
            domain: t.domain.clone(),
            aliases: t.related_terms.clone(),
        })
        .collect();
    format::write_lexicon(residual_dir, &lexicon)?;
    report.lexicon_terms = lexicon.len();

    // --- stressors + purposes → forces + residues ---
    let stressors = crate::storage::stressors::load(residual_dir)?;
    let purposes = crate::storage::purposes::load(residual_dir)?;
    let mut forces = Vec::new();
    let mut residues = Vec::new();
    let mut residue_n: u32 = 0;
    let mut unmapped = Vec::new();

    let mut push_components = |force_id: &str, field: &str| {
        for token in split_component_field(field) {
            let (component_id, notes) = match map_component_token(&token) {
                Some(mapped) => (mapped, format!("migrated from naive token '{token}'")),
                None => {
                    unmapped.push(token.clone());
                    (
                        token.clone(),
                        format!("migrated unmapped naive token '{token}'"),
                    )
                }
            };
            residue_n += 1;
            residues.push(Residue {
                id: format!("R-{residue_n:02}"),
                force_id: force_id.to_string(),
                component_id,
                status: "proposed".to_string(),
                notes,
            });
        }
    };

    for s in &stressors {
        let outcomes = split_outcomes(&s.traits, &s.description);
        let shortname = shortname_for(
            &s.id,
            &[&s.traits, &s.description, &s.naive_change],
            &term_names,
        );
        forces.push(Force {
            id: s.id.clone(),
            kind: ForceKind::Stressor,
            shortname,
            naive_change: s.naive_change.clone(),
            outcomes,
            description: s.description.clone(),
            attractor_id: s.attractor_id.clone(),
        });
        push_components(&s.id, &s.components_affected);
    }

    for p in &purposes {
        let outcomes = split_outcomes(&p.traits, &p.description);
        let shortname = shortname_for(
            &p.id,
            &[&p.traits, &p.description, &p.feature],
            &term_names,
        );
        forces.push(Force {
            id: p.id.clone(),
            kind: ForceKind::Purpose,
            shortname,
            naive_change: p.feature.clone(),
            outcomes,
            description: p.description.clone(),
            attractor_id: p.attractor_id.clone(),
        });
        push_components(&p.id, &p.components_enabled);
    }

    format::write_forces(residual_dir, &forces)?;
    write_residues(residual_dir, &residues)?;
    report.forces = forces.len();
    report.residues = residues.len();
    unmapped.sort();
    unmapped.dedup();
    report.unmapped_components = unmapped;

    // --- attractors valence → +/- states ---
    let attractors_path = residual_dir.join("attractors.csv");
    if attractors_path.exists() {
        let header = {
            let text = fs::read_to_string(&attractors_path)?;
            text.lines().next().unwrap_or("").to_string()
        };
        let v3_attractors = if header.contains("positive_state") {
            // Already v3 — re-load via format if present; else leave.
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
    fn migrate_residual_dir_writes_forces_residues_lexicon_and_v3_attractors() {
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
        fs::write(
            residual.join("stressors.csv"),
            "id,description,naive_change,traits,components_affected,attractor_id\nS-01,skill stub drifts,pin versions,skill residue stays current,skill-install skill-check,A-02\n",
        )
        .unwrap();
        fs::write(
            residual.join("purposes.csv"),
            "id,description,feature,traits,components_enabled,attractor_id\nP-01,operator adds purposes,add purpose CLI,operator records a residue against an attractor,cli-add storage-purposes,A-01\n",
        )
        .unwrap();
        fs::write(
            residual.join("components.csv"),
            "name,description,status,architecture_set\ncli,hub,proposed,iter4-cli-hub\nskills-installer,install,proposed,iter4-cli-hub\nstructure-analysis-purposes,purposes,proposed,iter4-cli-hub\n",
        )
        .unwrap();

        let report = migrate_residual_dir(&residual, true).unwrap();
        assert!(report.config_migrated);
        assert_eq!(report.forces, 2);
        assert!(report.residues >= 4);
        assert_eq!(report.attractors, 2);
        assert_eq!(report.lexicon_terms, 2);

        let cfg = fs::read_to_string(residual.join("config.toml")).unwrap();
        assert!(cfg.contains("format_version = \"v3\""));
        assert!(cfg.contains("[verification]"));

        let forces = format::read_forces(&residual).unwrap();
        assert_eq!(forces.len(), 2);
        assert!(forces.iter().any(|f| f.kind == ForceKind::Stressor));
        assert!(forces.iter().any(|f| f.kind == ForceKind::Purpose));
        assert!(forces.iter().all(|f| !f.outcomes.is_empty()));

        let residues = format::read_residues(&residual).unwrap();
        assert!(residues.iter().any(|r| r.component_id == "skills-installer"));
        assert!(residues.iter().any(|r| r.component_id == "cli"));
        assert!(residues
            .iter()
            .any(|r| r.component_id == "structure-analysis-purposes"));

        let attractors = format::read_attractors_v3(&residual).unwrap();
        assert_eq!(attractors.len(), 2);
        assert!(!attractors[0].positive_state.is_empty());
        assert!(!attractors[0].negative_state.is_empty());
        let header = fs::read_to_string(residual.join("attractors.csv"))
            .unwrap()
            .lines()
            .next()
            .unwrap()
            .to_string();
        assert!(header.contains("positive_state"));
        assert!(!header.contains("valence"));

        let lexicon = format::read_lexicon(&residual).unwrap();
        assert_eq!(lexicon.len(), 2);
    }

    #[test]
    fn map_component_token_covers_dogfood_aliases() {
        assert_eq!(
            map_component_token("skill-install").as_deref(),
            Some("skills-installer")
        );
        assert_eq!(
            map_component_token("tag-scan").as_deref(),
            Some("structure-analysis-tag-scan")
        );
        assert_eq!(
            map_component_token("research-study").as_deref(),
            Some("research-study")
        );
        assert_eq!(map_component_token("nope-xyz"), None);
    }
}
