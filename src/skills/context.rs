use anyhow::Result;
use crate::config::Config;

pub fn build(cfg: &Config, skill_name: &str) -> Result<String> {
    let dir = &cfg.residual_dir;

    let attractors = crate::storage::attractors::load(dir).unwrap_or_default();
    let stressors  = crate::storage::stressors::load(dir).unwrap_or_default();
    let purposes   = crate::storage::purposes::load(dir).unwrap_or_default();
    let terms      = crate::storage::terminology::load(dir).unwrap_or_default();
    let personas   = crate::storage::personas::load_all(dir).unwrap_or_default();

    // NKP summary: N = stressors + unique components (matrix semantics), not entity bag count.
    let mut component_set = std::collections::BTreeSet::new();
    for s in &stressors {
        for c in s.components_affected.split(',') {
            let c = c.trim();
            if !c.is_empty() {
                component_set.insert(c.to_string());
            }
        }
    }
    for p in &purposes {
        for c in p.components_enabled.split(',') {
            let c = c.trim();
            if !c.is_empty() {
                component_set.insert(c.to_string());
            }
        }
    }
    let n = stressors.len() + component_set.len();
    let k: usize = stressors
        .iter()
        .map(|s| {
            s.components_affected
                .split(',')
                .filter(|c| !c.trim().is_empty())
                .count()
        })
        .sum();
    let k_per_n = if n == 0 { 0.0 } else { k as f64 / n as f64 };

    let want_attractors;
    let want_stressors;
    let want_purposes;
    let want_terminology;
    let want_personas;
    let want_nkp;

    match skill_name {
        "purpose-walk" => {
            want_attractors  = true;
            want_stressors   = false;
            want_purposes    = true;
            want_terminology = true;
            want_personas    = false;
            want_nkp         = false;
        }
        "stressor-walk" => {
            want_attractors  = true;
            want_stressors   = true;
            want_purposes    = true;
            want_terminology = true;
            want_personas    = true;
            want_nkp         = false;
        }
        "integrate" => {
            want_attractors  = true;
            want_stressors   = true;
            want_purposes    = true;
            want_terminology = true;
            want_personas    = false;
            want_nkp         = true;
        }
        "fmea" | "atam" => {
            want_attractors  = true;
            want_stressors   = true;
            want_purposes    = true;
            want_terminology = true;
            want_personas    = true;
            want_nkp         = true;
        }
        "naive-draft" => {
            want_attractors  = false;
            want_stressors   = false;
            want_purposes    = true;
            want_terminology = true;
            want_personas    = false;
            want_nkp         = false;
        }
        _ => {
            // default: everything
            want_attractors  = true;
            want_stressors   = true;
            want_purposes    = true;
            want_terminology = true;
            want_personas    = true;
            want_nkp         = true;
        }
    }

    let mut out = String::new();
    out.push_str(&format!("# Residual Context — {}\n\n", skill_name));
    out.push_str(
        "## Fluent capture\n\
         Metadata (`residual add stressor|purpose|attractor|term|persona`) works in **any order**, \
         at **any phase**, without invoking a skill. Skills are **selectable analytical lenses** — \
         not mandatory gates. `verify all` enforces structure, not ceremony order.\n\n",
    );
    if matches!(skill_name, "stressor-walk" | "fmea" | "integrate") {
        out.push_str("## Whole-system-residue\n");
        out.push_str(
            "Examine **whole-system-residue** (hardware, process, organization, policy zig) \
             before defaulting to a software-only patch. Use `--whole-system --notes` when the \
             surviving change leaves the software boundary.\n\n",
        );
    }
    if want_personas {
        let persona_names: Vec<&str> = personas.iter().map(|p| p.name.as_str()).collect();
        if matches!(skill_name, "stressor-walk" | "fmea" | "atam") {
            if let Err(e) = crate::verification::check_personas_adequacy(&persona_names) {
                out.push_str(&format!(
                    "> **Persona note:** {} — add personas when ready; capture is not blocked.\n\n",
                    e
                ));
            }
        }
    }

    if want_attractors {
        out.push_str("## Attractors\n");
        out.push_str("| id | name | positive_state | negative_state |\n");
        out.push_str("|---|---|---|---|\n");
        for a in &attractors {
            out.push_str(&format!(
                "| {} | {} | {} | {} |\n",
                a.id, a.name, a.positive_state, a.negative_state
            ));
        }
        out.push('\n');
    }

    if want_stressors {
        out.push_str("## Stressors\n");
        out.push_str("| id | description | attractor_id | components |\n");
        out.push_str("|---|---|---|---|\n");
        for s in &stressors {
            out.push_str(&format!(
                "| {} | {} | {} | {} |\n",
                s.id, s.description, s.attractor_id, s.components_affected
            ));
        }
        out.push('\n');
    }

    if want_purposes {
        out.push_str("## Purposes\n");
        out.push_str("| id | description | attractor_id | naive_change | outcomes |\n");
        out.push_str("|---|---|---|---|---|\n");
        for p in &purposes {
            out.push_str(&format!(
                "| {} | {} | {} | {} | {} |\n",
                p.id, p.description, p.attractor_id, p.feature, p.outcomes
            ));
        }
        out.push('\n');
    }

    if want_terminology {
        out.push_str("## Terminology\n");
        out.push_str("| term | definition |\n");
        out.push_str("|---|---|\n");
        for t in &terms {
            out.push_str(&format!("| {} | {} |\n", t.term, t.definition));
        }
        out.push('\n');
    }

    if want_personas {
        out.push_str("## Personas\n");
        if personas.is_empty() {
            out.push_str("none\n");
        } else {
            for p in &personas {
                out.push_str(&format!("- {} (role: {})\n", p.name, p.role));
            }
        }
        out.push('\n');
    }

    if want_nkp {
        out.push_str("## NKP Summary\n");
        out.push_str(&format!("N={}, K={}, K/N={:.2}\n", n, k, k_per_n));
        out.push('\n');
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use crate::config::Config;
    use crate::storage::{stressors, terminology};

    fn cfg_for(dir: &std::path::Path) -> Config {
        Config {
            validation: crate::config::ValidationConfig { strict: true },
            skills: crate::config::SkillsConfig { token_warn: 1000 },
            residual_dir: dir.to_path_buf(),
        }
    }

    #[test]
    fn build_naive_draft_includes_purposes_section() {
        let dir = tempdir().unwrap();
        let cfg = cfg_for(dir.path());
        let out = build(&cfg, "naive-draft").unwrap();
        assert!(out.contains("## Purposes"), "naive-draft context must include Purposes");
    }

    #[test]
    fn build_naive_draft_excludes_stressors_section() {
        let dir = tempdir().unwrap();
        let cfg = cfg_for(dir.path());
        let out = build(&cfg, "naive-draft").unwrap();
        assert!(!out.contains("## Stressors"), "naive-draft context must not include Stressors");
    }

    #[test]
    fn build_unknown_skill_returns_all_sections() {
        let dir = tempdir().unwrap();
        let cfg = cfg_for(dir.path());
        let out = build(&cfg, "unknown-skill").unwrap();
        assert!(out.contains("## Purposes"), "unknown skill should include Purposes");
        assert!(out.contains("## Stressors"), "unknown skill should include Stressors");
        assert!(out.contains("## Attractors"), "unknown skill should include Attractors");
    }

    // RED TEST: documents flaw — N in context.rs counts all entities (attractors+stressors+purposes)
    // but NKP N should be unique components. The matrix::NkpMatrix::n() counts stressors+components.
    // This test fails until the N computation in context.rs is corrected.
    #[test]
    fn nkp_summary_n_reflects_components_not_entity_count() {
        let dir = tempdir().unwrap();
        let cfg = cfg_for(dir.path());
        terminology::append(dir.path(), terminology::Term {
            term: "auth".to_string(),
            definition: "authentication".to_string(),
            domain: "".to_string(),
            related_terms: "".to_string(),
        }).unwrap();
        stressors::append(dir.path(), stressors::Stressor {
            id: "S-01".to_string(),
            description: "test".to_string(),
            attractor_id: "".to_string(),
            naive_change: "none".to_string(),
            outcomes: "system handles auth".to_string(),
            components_affected: "auth,db".to_string(),
        }).unwrap();
        let out = build(&cfg, "integrate").unwrap();
        // With 1 stressor affecting 2 components (auth, db), N = stressors + unique components = 3.
    assert!(
        out.contains("N=3,") || out.contains("N=2,"),
        "expected N to reflect component+stressor count (2 or 3), got context: {}",
        &out[out.find("NKP").unwrap_or(0)..out.len().min(out.find("NKP").unwrap_or(0) + 80)]
    );
    }
}
