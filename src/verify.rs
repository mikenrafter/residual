use anyhow::Result;
use crate::config::Config;
use crate::cli::VerifyCheck;

pub fn run(cfg: &Config, check: VerifyCheck) -> Result<()> {
    todo!("dispatch verify checks")
}

pub fn check_traits(cfg: &Config) -> Result<Vec<TraitViolation>> {
    todo!("validate all traits reference ≥1 terminology term")
}

pub fn check_links(cfg: &Config) -> Result<Vec<LinkViolation>> {
    todo!("validate all attractor_ids exist in attractors.csv")
}

pub struct TraitViolation {
    pub source: String,
    pub id: String,
    pub trait_str: String,
    pub reason: String,
}

pub struct LinkViolation {
    pub source: String,
    pub id: String,
    pub missing_attractor_id: String,
}

/// Parse a trait string into (subject, verb, predicates).
/// Format: "<subject> <verb> <pred1>[; <pred2>...]"
pub fn parse_trait(trait_str: &str) -> Option<TraitParts> {
    todo!("parse trait string into parts")
}

pub struct TraitParts {
    pub subject: String,
    pub verb: String,
    pub predicates: Vec<String>,
}

/// Check if any word in the trait touches the terminology set.
pub fn trait_uses_terminology(
    parts: &TraitParts,
    term_set: &std::collections::HashSet<String>,
) -> bool {
    todo!("check trait words against term set")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use tempfile::tempdir;
    use crate::config::Config;
    use crate::storage::stressors;
    use crate::storage::attractors;
    use crate::storage::terminology;

    fn cfg_for(dir: &std::path::Path) -> Config {
        Config {
            validation: crate::config::ValidationConfig { strict: true },
            skills: crate::config::SkillsConfig { token_warn: 1000 },
            residual_dir: dir.to_path_buf(),
        }
    }

    // --- parse_trait ---

    #[test]
    fn parse_trait_basic() {
        let parts = parse_trait("system handles auth via tokens").unwrap();
        assert_eq!(parts.subject, "system");
        assert_eq!(parts.verb, "handles");
        assert!(
            parts.predicates.iter().any(|p| p.contains("auth")),
            "predicates should contain 'auth', got {:?}",
            parts.predicates
        );
    }

    #[test]
    fn parse_trait_empty_returns_none() {
        assert!(parse_trait("").is_none());
    }

    // --- trait_uses_terminology ---

    #[test]
    fn trait_uses_terminology_match() {
        let parts = TraitParts {
            subject: "system".to_string(),
            verb: "handles".to_string(),
            predicates: vec!["auth".to_string()],
        };
        let mut terms = HashSet::new();
        terms.insert("auth".to_string());
        assert!(trait_uses_terminology(&parts, &terms));
    }

    #[test]
    fn trait_uses_terminology_no_match() {
        let parts = TraitParts {
            subject: "system".to_string(),
            verb: "does".to_string(),
            predicates: vec!["something".to_string()],
        };
        let mut terms = HashSet::new();
        terms.insert("auth".to_string());
        assert!(!trait_uses_terminology(&parts, &terms));
    }

    // --- check_traits ---

    #[test]
    fn check_traits_empty_terminology_warns_not_errors() {
        let dir = tempdir().unwrap();
        let cfg = cfg_for(dir.path());
        // A stressor with a trait, but no terminology loaded
        stressors::append(
            dir.path(),
            stressors::Stressor {
                id: "S-01".to_string(),
                description: "test stressor".to_string(),
                attractor_id: "A-01".to_string(),
                naive_change: "none".to_string(),
                traits: "system handles auth".to_string(),
                components_affected: "auth".to_string(),
            },
        ).unwrap();
        // With empty terminology, check_traits should not return an Err,
        // but violations list may or may not be empty — the key check is it
        // doesn't panic/error (warn behaviour). When strict=false it returns empty.
        // When strict=true with empty terminology, each trait is a violation.
        // Either way it must not Err.
        let result = check_traits(&cfg);
        assert!(result.is_ok(), "check_traits should not error on empty terminology");
    }

    #[test]
    fn check_traits_valid_trait_no_violations() {
        let dir = tempdir().unwrap();
        let cfg = cfg_for(dir.path());
        terminology::append(
            dir.path(),
            terminology::Term {
                term: "auth".to_string(),
                definition: "authentication".to_string(),
                domain: "core".to_string(),
                related_terms: "".to_string(),
            },
        ).unwrap();
        stressors::append(
            dir.path(),
            stressors::Stressor {
                id: "S-01".to_string(),
                description: "test stressor".to_string(),
                attractor_id: "A-01".to_string(),
                naive_change: "none".to_string(),
                traits: "system handles auth".to_string(),
                components_affected: "auth".to_string(),
            },
        ).unwrap();
        let violations = check_traits(&cfg).unwrap();
        assert!(violations.is_empty(), "expected no violations for valid trait");
    }

    #[test]
    fn check_traits_no_matching_term_is_violation() {
        let dir = tempdir().unwrap();
        let cfg = cfg_for(dir.path());
        terminology::append(
            dir.path(),
            terminology::Term {
                term: "auth".to_string(),
                definition: "authentication".to_string(),
                domain: "core".to_string(),
                related_terms: "".to_string(),
            },
        ).unwrap();
        stressors::append(
            dir.path(),
            stressors::Stressor {
                id: "S-01".to_string(),
                description: "test stressor".to_string(),
                attractor_id: "A-01".to_string(),
                naive_change: "none".to_string(),
                // none of these words appear in terminology
                traits: "widget frobs blorple".to_string(),
                components_affected: "widget".to_string(),
            },
        ).unwrap();
        let violations = check_traits(&cfg).unwrap();
        assert!(!violations.is_empty(), "expected violation for trait with no terminology match");
    }

    // --- check_links ---

    #[test]
    fn check_links_missing_attractor_is_violation() {
        let dir = tempdir().unwrap();
        let cfg = cfg_for(dir.path());
        stressors::append(
            dir.path(),
            stressors::Stressor {
                id: "S-01".to_string(),
                description: "test".to_string(),
                attractor_id: "A-99".to_string(), // does not exist
                naive_change: "none".to_string(),
                traits: "system does x".to_string(),
                components_affected: "x".to_string(),
            },
        ).unwrap();
        let violations = check_links(&cfg).unwrap();
        assert!(!violations.is_empty(), "expected violation for nonexistent attractor");
        assert_eq!(violations[0].missing_attractor_id, "A-99");
    }

    #[test]
    fn check_links_existing_attractor_no_violation() {
        let dir = tempdir().unwrap();
        let cfg = cfg_for(dir.path());
        attractors::append(
            dir.path(),
            attractors::Attractor {
                id: "A-01".to_string(),
                name: "Stability".to_string(),
                valence: attractors::Valence::Positive,
                description: "stable".to_string(),
                phase_state: "active".to_string(),
            },
        ).unwrap();
        stressors::append(
            dir.path(),
            stressors::Stressor {
                id: "S-01".to_string(),
                description: "test".to_string(),
                attractor_id: "A-01".to_string(),
                naive_change: "none".to_string(),
                traits: "system does x".to_string(),
                components_affected: "x".to_string(),
            },
        ).unwrap();
        let violations = check_links(&cfg).unwrap();
        assert!(violations.is_empty(), "expected no violations when attractor exists");
    }
}
