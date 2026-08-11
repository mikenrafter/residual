use anyhow::Result;
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
    todo!("print skill content or version")
}

pub fn install(name: &str, agent: &str, global: bool) -> Result<()> {
    todo!("install skill to agent config dir")
}

pub fn data(cfg: &Config, name: &str) -> Result<()> {
    todo!("print formatted skill context from residual/ data")
}

pub fn list_all() -> Result<()> {
    todo!("print table of skill name / version / estimated tokens")
}

pub fn check(name: &str, agent: &str) -> Result<()> {
    todo!("compare installed skill version to embedded version")
}

pub fn generate_completions() -> Result<()> {
    todo!("print fish completions to stdout")
}

pub fn generate_man() -> Result<()> {
    todo!("print troff man page to stdout")
}

pub fn install_hook() -> Result<()> {
    todo!("write hooks/pre-commit to .git/hooks/pre-commit")
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
