use anyhow::Result;
use std::fs;
use crate::config::Config;
use crate::cli::{AddTarget, ListTarget};
use crate::structure::analysis::residues::Residue;

pub mod attractors;
pub mod config;
pub mod format;
pub mod integrity;
pub mod iterations;
pub mod personas;
pub mod purposes;
pub mod residues;
pub mod research;
pub mod stressors;
pub mod terminology;

pub fn init(cfg: &Config, force: bool) -> Result<()> {
    let session = integrity::sessions::begin_mutation(&cfg.residual_dir, force)?;
    init_dirs_and_files(cfg)?;
    session.commit()?;
    println!("Initialized residual/ at {}", cfg.residual_dir.display());
    Ok(())
}

fn init_dirs_and_files(cfg: &Config) -> Result<()> {
    let dir = &cfg.residual_dir;
    fs::create_dir_all(dir.join("iterations"))?;
    fs::create_dir_all(dir.join("personas"))?;
    fs::create_dir_all(dir.join("research"))?;

    // Write v3 config.toml if not present (storage-config owns app + verify policy).
    let config_path = dir.join("config.toml");
    if !config_path.exists() {
        let toml = crate::storage::config::render_v3(&crate::storage::config::StorageConfig::default());
        fs::write(&config_path, toml)?;
    }

    // Write empty CSVs with headers if not present
    let csvs: &[(&str, &str)] = &[
        ("stressors.csv", "id,description,naive_change,outcomes,components_affected,attractor_id"),
        ("purposes.csv", "id,description,feature,outcomes,components_enabled,attractor_id"),
        ("attractors.csv", "id,name,description,positive_state,negative_state"),
        ("terminology.csv", "term,definition,domain,related_terms"),
        ("forces.csv", "id,kind,shortname,naive_change,outcomes,description,attractor_id"),
        ("lexicon.csv", "term,definition,domain,aliases"),
        ("residues.csv", "force"),
        ("components.csv", "name,description,status,architecture_set"),
    ];
    for (filename, header) in csvs {
        let path = dir.join(filename);
        if !path.exists() {
            fs::write(&path, format!("{}\n", header))?;
        }
    }
    Ok(())
}

pub fn add(cfg: &Config, target: AddTarget, force: bool) -> Result<()> {
    let session = integrity::sessions::begin_mutation(&cfg.residual_dir, force)?;
    add_entry(cfg, target)?;
    session.commit()?;
    Ok(())
}

fn add_entry(cfg: &Config, target: AddTarget) -> Result<()> {
    let dir = &cfg.residual_dir;
    match target {
        AddTarget::Stressor { description, attractor_id, naive_change, outcomes, components } => {
            let existing = stressors::load(dir)?;
            let id = stressors::next_id(&existing);
            stressors::append(dir, stressors::Stressor {
                id: id.clone(),
                description,
                attractor_id,
                naive_change,
                outcomes,
                components_affected: components,
            })?;
            println!("Added stressor {}", id);
        }
        AddTarget::Purpose { description, attractor_id, feature, outcomes, components } => {
            let existing = purposes::load(dir)?;
            let id = purposes::next_id(&existing);
            purposes::append(dir, purposes::Purpose {
                id: id.clone(),
                description,
                attractor_id,
                feature,
                outcomes,
                components_enabled: components,
            })?;
            println!("Added purpose {}", id);
        }
        AddTarget::Attractor {
            name,
            description,
            positive_state,
            negative_state,
        } => {
            let existing = attractors::load(dir)?;
            let id = attractors::next_id(&existing);
            attractors::append(
                dir,
                attractors::Attractor {
                    id: id.clone(),
                    name,
                    description,
                    positive_state,
                    negative_state,
                },
            )?;
            println!("Added attractor {}", id);
        }
        AddTarget::Term { term, definition, domain, related } => {
            terminology::append(dir, terminology::Term {
                term: term.clone(),
                definition,
                domain,
                related_terms: related,
            })?;
            println!("Added term '{}'", term);
        }
        AddTarget::Persona { name, role, concerns, desires } => {
            personas::create(dir, personas::Persona {
                name: name.clone(),
                role,
                concerns,
                desires,
                stressor_ids: vec![],
            })?;
            println!("Added persona '{}'", name);
        }
        AddTarget::Residue { force_id, component_id, status, notes } => {
            if !residues::force_exists(dir, &force_id)? { anyhow::bail!("force id '{}' not found", force_id); }
            let existing = residues::load(dir)?; let id = residues::next_id(&existing);
            residues::append(dir, Residue { id: id.clone(), force_id, component_id, status, notes })?;
            println!("Added residue {}", id);
        }
        AddTarget::Iteration { notes, ri_score } => {
            let n = iterations::next_n(dir)?;
            let date = chrono::Local::now().format("%Y-%m-%d").to_string();
            iterations::create(dir, iterations::IterationMeta {
                n,
                date,
                ri_score,
                n_val: String::new(),
                k_val: String::new(),
                p_val: String::new(),
                notes,
            })?;
            println!("Added iteration {}", n);
        }
    }
    Ok(())
}

pub fn list(cfg: &Config, target: ListTarget) -> Result<()> {
    let dir = &cfg.residual_dir;
    match target {
        ListTarget::Stressors => {
            let items = stressors::load(dir)?;
            if items.is_empty() {
                println!("No stressors.");
            } else {
                for s in &items {
                    println!("[{}] {} (attractor: {})", s.id, s.description, s.attractor_id);
                }
            }
        }
        ListTarget::Purposes => {
            let items = purposes::load(dir)?;
            if items.is_empty() {
                println!("No purposes.");
            } else {
                for p in &items {
                    println!("[{}] {} (feature: {})", p.id, p.description, p.feature);
                }
            }
        }
        ListTarget::Attractors => {
            let items = attractors::load(dir)?;
            if items.is_empty() {
                println!("No attractors.");
            } else {
                for a in &items {
                    println!(
                        "[{}] {} (+/{} | -/{} )",
                        a.id,
                        a.name,
                        truncate_state(&a.positive_state),
                        truncate_state(&a.negative_state)
                    );
                }
            }
        }
        ListTarget::Terminology => {
            let items = terminology::load(dir)?;
            if items.is_empty() {
                println!("No terminology.");
            } else {
                for t in &items {
                    println!("{}: {}", t.term, t.definition);
                }
            }
        }
        ListTarget::Personas => {
            let names = personas::list_names(dir)?;
            if names.is_empty() {
                println!("No personas.");
            } else {
                for name in &names {
                    println!("{}", name);
                }
            }
        }
        ListTarget::Residues => { let matrix = format::format_residues_matrix(dir)?; if matrix.lines().count()<=1 { println!("No residues."); } else { print!("{matrix}"); } }
        ListTarget::Iterations => {
            let items = iterations::list(dir)?;
            if items.is_empty() {
                println!("No iterations.");
            } else {
                let mut sorted = items;
                sorted.sort_by_key(|i| i.n);
                for meta in &sorted {
                    println!("Iteration {}: {} (Ri: {})", meta.n, meta.date, meta.ri_score);
                }
            }
        }
    }
    Ok(())
}

fn truncate_state(s: &str) -> String {
    const MAX: usize = 40;
    if s.chars().count() <= MAX {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(MAX).collect();
        out.push('…');
        out
    }
}

/// Run naive → v3 migration for the project's residual/ directory.
pub fn migrate(cfg: &Config, force: bool) -> Result<()> {
    let report = integrity::migration::migrate_residual_dir(&cfg.residual_dir, force)?;
    println!(
        "Migrated {} → v3 (config={}, forces={}, residues={}, attractors={}, lexicon={})",
        cfg.residual_dir.display(),
        report.config_migrated,
        report.forces,
        report.residues,
        report.attractors,
        report.lexicon_terms
    );
    if !report.unmapped_components.is_empty() {
        println!(
            "Unmapped naive component tokens (left as-is): {}",
            report.unmapped_components.join(", ")
        );
    }
    Ok(())
}
