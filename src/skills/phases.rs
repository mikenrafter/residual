//! Phases — all phase skills (stub + full) + data each skill needs.
//! Owns: skill-list, skill-show, skill-data, and ATAM+FMEA prose content.
//!
//! Installed agent files may be thin shims; the **full** methodology lives in
//! `skills/definitions/` and is served by `skill-show` / the binary (S-07).
//! ATAM/FMEA skill definitions live under skills/definitions/; numeric NKP work
//! stays in structure-analysis.

use anyhow::Result;
use crate::config::Config;

pub fn show(name: &str, version_only: bool) -> Result<()> {
    crate::skills::show(name, version_only)
}

pub fn data(cfg: &Config, name: &str) -> Result<()> {
    if crate::skills::find(name).is_none() {
        anyhow::bail!("skill '{}' not found", name);
    }
    // Personas adequacy is advisory in skill-data (fluent / a-la-carte); verify
    // and soft notes in context may still surface min:2 until α/β exist.
    crate::skills::data(cfg, name)
}

pub fn list_all() -> Result<()> {
    crate::skills::list_all()
}
