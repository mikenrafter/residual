use anyhow::{Context, Result};
use crate::config::Config;

pub mod context;
pub mod install;
pub mod installer;
pub mod personas;
pub mod phases;
pub mod research;

pub const SKILLS: &[(&str, &str, u32)] = &[
    ("purpose-walk",   include_str!("definitions/purpose_walk.md"),   0),
    ("naive-draft",    include_str!("definitions/naive_draft.md"),     0),
    ("stressor-walk",  include_str!("definitions/stressor_walk.md"),   0),
    ("integrate",      include_str!("definitions/integrate.md"),       0),
    ("fmea",           include_str!("definitions/fmea.md"),            0),
    ("atam",           include_str!("definitions/atam.md"),            0),
];

pub fn find(name: &str) -> Option<(&'static str, u32)> {
    SKILLS.iter()
        .find(|(n, _, _)| *n == name)
        .map(|(_, content, version)| (*content, *version))
}

pub fn show(name: &str, version_only: bool) -> Result<()> {
    let (content, version) = find(name)
        .with_context(|| format!("skill '{}' not found", name))?;
    if version_only {
        println!("{}", version);
    } else {
        print!("{}", content);
    }
    Ok(())
}

pub fn install(name: &str, agent: &str, global: bool) -> Result<()> {
    let (content, _version) = find(name)
        .with_context(|| format!("skill '{}' not found", name))?;
    let agent_parsed: install::Agent = agent.parse()?;
    let path = install::install_path(name, &agent_parsed, global)?;
    install::write_skill(&path, content)?;
    println!("Installed '{}' to {}", name, path.display());
    Ok(())
}

pub fn data(cfg: &Config, name: &str) -> Result<()> {
    // Verify the skill exists first
    if find(name).is_none() {
        anyhow::bail!("skill '{}' not found", name);
    }
    let output = context::build(cfg, name)?;
    print!("{}", output);
    Ok(())
}

pub fn list_all() -> Result<()> {
    println!(
        "Skills are selectable analytical lenses (a-la-carte) — invoke only the steps your workflow needs.\n"
    );
    println!("{:<20} {:>7}  {:>12}", "SKILL", "VERSION", "TOKENS (~)");
    println!("{}", "-".repeat(44));
    for (name, content, version) in SKILLS {
        let tokens = estimate_tokens(content);
        println!("{:<20} {:>7}  {:>12}", name, version, tokens);
    }
    Ok(())
}

pub fn check(name: &str, agent: &str) -> Result<()> {
    let (_content, embedded_version) = find(name)
        .with_context(|| format!("skill '{}' not found", name))?;
    let agent_parsed: install::Agent = agent.parse()?;
    match install::installed_version(name, &agent_parsed, false)? {
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

pub fn generate_completions() -> Result<()> {
    crate::cli::help::generate_completions()
}

pub fn generate_man() -> Result<()> {
    crate::cli::help::generate_man()
}

pub fn install_hook() -> Result<()> {
    crate::verification::git_hook::install()
}

/// Rough token estimate: ~0.75 tokens per character (conservative)
pub fn estimate_tokens(content: &str) -> usize {
    (content.len() as f64 * 0.75) as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_purpose_walk_returns_some_with_title() {
        let result = find("purpose-walk");
        assert!(result.is_some(), "expected Some for 'purpose-walk'");
        let (content, _version) = result.unwrap();
        assert!(
            content.contains("Purpose Walk"),
            "expected 'Purpose Walk' in content, got: {}",
            &content[..content.len().min(200)]
        );
    }

    #[test]
    fn find_nonexistent_returns_none() {
        assert!(find("nonexistent-skill").is_none());
    }

    #[test]
    fn estimate_tokens_empty_string() {
        assert_eq!(estimate_tokens(""), 0);
    }

    #[test]
    fn estimate_tokens_hello_world() {
        // "hello world" = 11 chars → 11 * 0.75 = 8
        let tokens = estimate_tokens("hello world");
        assert!(
            tokens >= 6 && tokens <= 10,
            "expected ~8 tokens (±2), got {}",
            tokens
        );
    }

    #[test]
    fn all_six_skills_present() {
        let names: Vec<&str> = SKILLS.iter().map(|(n, _, _)| *n).collect();
        for expected in &["purpose-walk", "naive-draft", "stressor-walk", "integrate", "fmea", "atam"] {
            assert!(names.contains(expected), "missing skill: {}", expected);
        }
        assert_eq!(SKILLS.len(), 6, "expected exactly 6 skills");
    }
}
