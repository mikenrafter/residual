//! Installer — skill-install and skill check-install (rename from skill-check).

use anyhow::Result;

pub fn install(name: &str, agent: &str, global: bool) -> Result<()> {
    crate::skills::install(name, agent, global)
}

/// Check whether an installed skill is a healthy passthrough (S-07) or matches embedded version.
/// Primary name: `check-install`. `skill-check` remains an alias.
pub fn check_install(name: &str, agent: &str) -> Result<()> {
    check(name, agent)
}

pub fn check(name: &str, agent: &str) -> Result<()> {
    crate::skills::check(name, agent)
}
