use anyhow::Result;
use crate::config::Config;

pub fn build(cfg: &Config, skill_name: &str) -> Result<String> {
    let dir = &cfg.residual_dir;

    let attractors = crate::storage::attractors::load(dir).unwrap_or_default();
    let stressors  = crate::storage::stressors::load(dir).unwrap_or_default();
    let purposes   = crate::storage::purposes::load(dir).unwrap_or_default();
    let terms      = crate::storage::terminology::load(dir).unwrap_or_default();
    let personas   = crate::storage::personas::load_all(dir).unwrap_or_default();

    // NKP summary values
    let n = attractors.len() + stressors.len() + purposes.len();
    let k: usize = stressors.iter().map(|s| {
        s.components_affected.split(',').filter(|c| !c.trim().is_empty()).count()
    }).sum();
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

    if want_attractors {
        out.push_str("## Attractors\n");
        out.push_str("| id | name | valence | description |\n");
        out.push_str("|---|---|---|---|\n");
        for a in &attractors {
            out.push_str(&format!(
                "| {} | {} | {} | {} |\n",
                a.id, a.name, a.valence, a.description
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
        out.push_str("| id | description | attractor_id | feature |\n");
        out.push_str("|---|---|---|---|\n");
        for p in &purposes {
            out.push_str(&format!(
                "| {} | {} | {} | {} |\n",
                p.id, p.description, p.attractor_id, p.feature
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
