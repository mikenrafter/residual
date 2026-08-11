use anyhow::Result;
use std::fs;
use crate::config::Config;
use crate::cli::{AddTarget, ListTarget};

pub mod attractors;
pub mod iterations;
pub mod personas;
pub mod purposes;
pub mod research;
pub mod stressors;
pub mod terminology;

pub fn init(cfg: &Config) -> Result<()> {
    let dir = &cfg.residual_dir;
    fs::create_dir_all(dir.join("iterations"))?;
    fs::create_dir_all(dir.join("personas"))?;
    fs::create_dir_all(dir.join("research"))?;

    // Write empty config.toml if not present
    let config_path = dir.join("config.toml");
    if !config_path.exists() {
        fs::write(&config_path, "# residual configuration\n[validation]\nstrict = true\n\n[skills]\ntoken_warn = 1000\n")?;
    }

    // Write empty CSVs with headers if not present
    let csvs: &[(&str, &str)] = &[
        ("stressors.csv", "id,description,naive_change,traits,components_affected,attractor_id"),
        ("purposes.csv", "id,description,feature,traits,components_enabled,attractor_id"),
        ("attractors.csv", "id,name,valence,description,phase_state"),
        ("terminology.csv", "term,definition,domain,related_terms"),
    ];
    for (filename, header) in csvs {
        let path = dir.join(filename);
        if !path.exists() {
            fs::write(&path, format!("{}\n", header))?;
        }
    }

    println!("Initialized residual/ at {}", dir.display());
    Ok(())
}

pub fn add(cfg: &Config, target: AddTarget) -> Result<()> {
    let dir = &cfg.residual_dir;
    match target {
        AddTarget::Stressor { description, attractor_id, naive_change, traits, components } => {
            let existing = stressors::load(dir)?;
            let id = stressors::next_id(&existing);
            stressors::append(dir, stressors::Stressor {
                id: id.clone(),
                description,
                attractor_id,
                naive_change,
                traits,
                components_affected: components,
            })?;
            println!("Added stressor {}", id);
        }
        AddTarget::Purpose { description, attractor_id, feature, traits, components } => {
            let existing = purposes::load(dir)?;
            let id = purposes::next_id(&existing);
            purposes::append(dir, purposes::Purpose {
                id: id.clone(),
                description,
                attractor_id,
                feature,
                traits,
                components_enabled: components,
            })?;
            println!("Added purpose {}", id);
        }
        AddTarget::Attractor { name, valence, description, phase_state } => {
            let existing = attractors::load(dir)?;
            let id = attractors::next_id(&existing);
            let valence: attractors::Valence = valence.parse()?;
            attractors::append(dir, attractors::Attractor {
                id: id.clone(),
                name,
                valence,
                description,
                phase_state,
            })?;
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
                    println!("[{}] {} ({:?})", a.id, a.name, a.valence);
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
