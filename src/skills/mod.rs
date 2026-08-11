use anyhow::{Context, Result};
use crate::config::Config;

pub mod context;
pub mod install;

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
    print!(r#"# residual fish completions
complete -c residual -f
complete -c residual -n '__fish_use_subcommand' -a 'init' -d 'Initialize residual/ directory'
complete -c residual -n '__fish_use_subcommand' -a 'add' -d 'Add entries'
complete -c residual -n '__fish_use_subcommand' -a 'list' -d 'List entries'
complete -c residual -n '__fish_use_subcommand' -a 'verify' -d 'Verify data integrity'
complete -c residual -n '__fish_use_subcommand' -a 'matrix' -d 'NKP matrix operations'
complete -c residual -n '__fish_use_subcommand' -a 'skill-show' -d 'Show skill definition'
complete -c residual -n '__fish_use_subcommand' -a 'skill-install' -d 'Install skill to agent'
complete -c residual -n '__fish_use_subcommand' -a 'skill-data' -d 'Show skill context data'
complete -c residual -n '__fish_use_subcommand' -a 'skill-list' -d 'List all skills'
complete -c residual -n '__fish_use_subcommand' -a 'skill-check' -d 'Check installed skill version'
complete -c residual -n '__fish_use_subcommand' -a 'tag' -d 'Tag operations'
complete -c residual -n '__fish_use_subcommand' -a 'generate' -d 'Generate artifacts'
complete -c residual -n '__fish_use_subcommand' -a 'config' -d 'Show configuration'
complete -c residual -n '__fish_seen_subcommand_from skill-show skill-install skill-data skill-check' -a 'purpose-walk naive-draft stressor-walk integrate fmea atam'
complete -c residual -n '__fish_seen_subcommand_from skill-install' -l agent -a 'claude cursor copilot agnostic'
complete -c residual -n '__fish_seen_subcommand_from skill-install' -l global -d 'Install user-wide'
complete -c residual -n '__fish_seen_subcommand_from add' -a 'stressor purpose attractor term persona iteration'
complete -c residual -n '__fish_seen_subcommand_from list' -a 'stressors purposes attractors terminology personas iterations'
complete -c residual -n '__fish_seen_subcommand_from verify' -a 'traits links all'
complete -c residual -n '__fish_seen_subcommand_from matrix' -a 'show calc criticality ri fusion fission'
complete -c residual -n '__fish_seen_subcommand_from tag' -a 'scan report'
complete -c residual -n '__fish_seen_subcommand_from generate' -a 'completions man hook'
"#);
    Ok(())
}

pub fn generate_man() -> Result<()> {
    print!(r#".TH RESIDUAL 1 "2026" "residual 0.1.0" "NKP Residuality CLI"
.SH NAME
residual \- NKP Residuality architecture CLI
.SH SYNOPSIS
.B residual
[\fICOMMAND\fR] [\fIOPTIONS\fR]
.SH DESCRIPTION
\fBresidual\fR is a command-line tool for applying NKP (N-K-P) Residuality theory
to software architecture. It tracks stressors, attractors, purposes, and terminology,
and provides skills (AI prompts) for structured architectural reasoning.
.SH COMMANDS
.TP
.B init
Initialize the residual/ directory in the current project.
.TP
.B add \fITARGET\fR
Add a new entry. Targets: stressor, purpose, attractor, term, persona, iteration.
.TP
.B list \fITARGET\fR
List entries. Targets: stressors, purposes, attractors, terminology, personas, iterations.
.TP
.B verify \fICHECK\fR
Verify data integrity. Checks: traits, links, all.
.TP
.B matrix \fIOP\fR
NKP matrix operations: show, calc, criticality, ri, fusion, fission.
.TP
.B skill-show \fINAME\fR
Show the definition of a skill. Use \fI--version\fR to show only the version number.
.TP
.B skill-install \fINAME\fR
Install a skill to an agent config directory. Options: \fI--agent\fR, \fI--global\fR.
.TP
.B skill-data \fINAME\fR
Print the current project context formatted for the named skill.
.TP
.B skill-list
List all available skills with name, version, and estimated token count.
.TP
.B skill-check \fINAME\fR
Compare the installed skill version to the embedded version.
.TP
.B tag scan [\fIPATH\fR]
Scan source files for @residue: and @stressor: tags.
.TP
.B tag report [\fIPATH\fR]
Report all tags found in source files.
.TP
.B generate completions
Print fish shell completions to stdout.
.TP
.B generate man
Print this man page to stdout.
.TP
.B generate hook
Write the pre-commit hook to .git/hooks/pre-commit.
.TP
.B config
Show the current configuration.
.SH FILES
\fI$PROJECT/residual/\fR
The project's residual data directory.
.SH AUTHOR
Mike Nrafter
"#);
    Ok(())
}

pub fn install_hook() -> Result<()> {
    // Walk up from current_dir to find .git/
    let cwd = std::env::current_dir().context("failed to get current directory")?;
    let mut dir = cwd.as_path();
    let git_hooks_dir = loop {
        let candidate = dir.join(".git/hooks");
        if candidate.is_dir() {
            break candidate;
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => anyhow::bail!("could not find .git/hooks directory (not a git repository?)"),
        }
    };

    let hook_path = git_hooks_dir.join("pre-commit");
    let hook_content = r#"#!/usr/bin/env bash
# residual pre-commit hook — validates residual/ data before commit
STAGED=$(git diff --cached --name-only | grep '^residual/')

if [ -z "$STAGED" ]; then
  STRICT=$(residual config 2>/dev/null | grep 'strict' | awk '{print $3}')
  [ "$STRICT" = "false" ] && exit 0
fi

residual verify all || exit 1
"#;

    std::fs::write(&hook_path, hook_content)
        .with_context(|| format!("failed to write hook to {}", hook_path.display()))?;

    // Make executable (mode 0o755)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&hook_path)?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&hook_path, perms)
            .with_context(|| format!("failed to set permissions on {}", hook_path.display()))?;
    }

    println!("Installed pre-commit hook to {}", hook_path.display());
    Ok(())
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
