//! Phases — all phase skills (stub + full) + data each skill needs.

use anyhow::Result;
use crate::config::Config;

pub fn show(name: &str, version_only: bool) -> Result<()> {
    crate::skills::show(name, version_only)
}

pub fn data(cfg: &Config, name: &str) -> Result<()> {
    if crate::skills::find(name).is_none() {
        anyhow::bail!("skill '{}' not found", name);
    }
    crate::skills::data(cfg, name)
}

pub fn list_all() -> Result<()> {
    crate::skills::list_all()
}
