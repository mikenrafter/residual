//! Installer — skill-install and skill check-install (rename from skill-check).

use anyhow::{Context, Result};

pub fn install(name: &str, agent: &str, global: bool) -> Result<()> {
    crate::skills::install(name, agent, global)
}

/// Check whether an installed skill matches the embedded version.
/// Primary name: `check-install`. `skill-check` remains an alias.
pub fn check_install(name: &str, agent: &str) -> Result<()> {
    check(name, agent)
}

pub fn check(name: &str, agent: &str) -> Result<()> {
    let (_content, embedded_version) = crate::skills::find(name)
        .with_context(|| format!("skill '{}' not found", name))?;
    let agent_parsed: crate::skills::install::Agent = agent.parse()?;
    match crate::skills::install::installed_version(name, &agent_parsed, false)? {
        None => {
            println!("'{}' is not installed for agent '{}'.", name, agent);
        }
        Some(installed_ver) => {
            if installed_ver == embedded_version {
                println!("'{}' is up to date (version {}).", name, installed_ver);
            } else {
                println!(
                    "'{}' is outdated: installed version {}, embedded version {}.",
                    name, installed_ver, embedded_version
                );
            }
        }
    }
    Ok(())
}
