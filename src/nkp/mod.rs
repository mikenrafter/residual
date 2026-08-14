use anyhow::Result;
use std::collections::HashMap;

use crate::cli::{MatrixOp, MatrixSortBy};
use crate::config::Config;


pub mod criticality;
pub mod matrix;
pub mod residual_index;

fn force_shortnames(residual_dir: &std::path::Path) -> Result<HashMap<String, String>> {
    let mut map = HashMap::new();
    for s in crate::storage::stressors::load(residual_dir)? {
        map.insert(s.id, s.shortname);
    }
    for p in crate::storage::purposes::load(residual_dir)? {
        map.insert(p.id, p.shortname);
    }
    Ok(map)
}

fn attractor_names(residual_dir: &std::path::Path) -> Result<HashMap<String, String>> {
    let attractors = crate::storage::attractors::load(residual_dir)?;
    Ok(attractors.into_iter().map(|a| (a.id, a.name)).collect())
}

pub fn run(cfg: &Config, op: MatrixOp) -> Result<()> {
    match op {
        MatrixOp::Show {
            csv,
            filter,
            sort_by,
        } => {
            let shortnames = force_shortnames(&cfg.residual_dir)?;
            let attractor_names = attractor_names(&cfg.residual_dir)?;
            let stressors = crate::storage::stressors::load(&cfg.residual_dir)?;
            let filtered = matrix::filter_stressors(&stressors, &filter, &shortnames);
            let ordered = matrix::sort_stressors(filtered, sort_by, &shortnames);
            let mut m = matrix::NkpMatrix::build(&ordered);
            if sort_by == MatrixSortBy::FusionFission {
                m.reorder_columns_fusion_fission();
            }
            if csv {
                m.print_csv(&shortnames, &attractor_names, sort_by)?;
            } else {
                m.print_colored(&shortnames, &attractor_names, sort_by);
            }
        }
        MatrixOp::Calc => {
            let stressors = crate::storage::stressors::load(&cfg.residual_dir)?;
            let m = matrix::NkpMatrix::build(&stressors);
            println!("N (nodes) = {}", m.n());
            println!("K (connections) = {}", m.k());
            println!(
                "K/N = {:.4}",
                if m.n() == 0 {
                    0.0
                } else {
                    m.k() as f64 / m.n() as f64
                }
            );
        }
        MatrixOp::Criticality => {
            let stressors = crate::storage::stressors::load(&cfg.residual_dir)?;
            let m = matrix::NkpMatrix::build(&stressors);
            let report = criticality::assess(&m);
            println!(
                "N = {}, K = {}, K/N = {:.4}",
                report.n, report.k, report.k_per_n
            );
            println!("Assessment: {}", report.assessment);
        }
        MatrixOp::Ri {
            stressors,
            naive_survived,
            residual_survived,
        } => {
            let ri = residual_index::calculate(naive_survived, residual_survived, stressors);
            let interpretation = residual_index::interpret(ri);
            println!("Ri = {:.4}", ri);
            println!("{}", interpretation);
        }
        MatrixOp::Fusion => {
            let stressors = crate::storage::stressors::load(&cfg.residual_dir)?;
            let m = matrix::NkpMatrix::build(&stressors);
            let candidates = m.fusion_candidates();
            if candidates.is_empty() {
                println!("No fusion candidates found.");
            } else {
                println!("Fusion candidates (identical stress-response patterns):");
                for (a, b) in &candidates {
                    println!("  {} ↔ {}", a, b);
                }
            }
        }
        MatrixOp::Fission => {
            let stressors = crate::storage::stressors::load(&cfg.residual_dir)?;
            let m = matrix::NkpMatrix::build(&stressors);
            let threshold = (m.stressor_ids.len() / 2).max(1);
            let candidates = m.fission_candidates(threshold);
            if candidates.is_empty() {
                println!("No fission candidates found (threshold = {}).", threshold);
            } else {
                println!("Fission candidates (col total > {}):", threshold);
                for comp in &candidates {
                    println!("  {}", comp);
                }
            }
        }
    }
    Ok(())
}
