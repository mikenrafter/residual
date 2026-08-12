//! Phases — all phase skills (stub + full) + data each skill needs.
//! Owns: skill-list, skill-show, skill-data, and ATAM+FMEA prose content.
//!
//! ATAM/FMEA skill definitions live under skills/definitions/; numeric NKP work
//! stays in structure-analysis.

use anyhow::{Context, Result};
use crate::config::Config;

pub fn show(name: &str, version_only: bool) -> Result<()> {
    crate::skills::show(name, version_only)
}

pub fn data(cfg: &Config, name: &str) -> Result<()> {
    if crate::skills::find(name).is_none() {
        anyhow::bail!("skill '{}' not found", name);
    }
    // Walks/sessions that consume personas: Verification enforces min:2.
    if matches!(name, "stressor-walk" | "fmea" | "atam") {
        let names = crate::skills::personas::list_names(&cfg.residual_dir).unwrap_or_default();
        crate::verification::check_personas_adequacy(&names)
            .with_context(|| format!("personas adequacy for skill '{}'", name))?;
    }
    crate::skills::data(cfg, name)
}

pub fn list_all() -> Result<()> {
    list()
}

pub fn list() -> Result<()> {
    crate::skills::list_all()
}
