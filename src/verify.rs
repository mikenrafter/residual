use anyhow::{bail, Result};
use crate::config::Config;
use crate::cli::VerifyCheck;

pub fn run(cfg: &Config, check: VerifyCheck) -> Result<()> {
    match check {
        VerifyCheck::Outcomes => {
            let violations = check_outcomes(cfg)?;
            if violations.is_empty() {
                println!("OK: all outcomes reference at least one terminology term.");
            } else {
                for v in &violations {
                    println!("VIOLATION [{}] {}: {} — {}", v.source, v.id, v.outcome_str, v.reason);
                }
                bail!("{} outcome violation(s) found.", violations.len());
            }
        }
        VerifyCheck::Links => {
            let violations = check_links(cfg)?;
            if violations.is_empty() {
                println!("OK: all attractor links are valid.");
            } else {
                for v in &violations {
                    println!("VIOLATION [{}] {}: missing attractor '{}'", v.source, v.id, v.missing_attractor_id);
                }
                bail!("{} link violation(s) found.", violations.len());
            }
        }
        VerifyCheck::All => {
            let outcome_violations = check_outcomes(cfg)?;
            let link_violations = check_links(cfg)?;
            let total = outcome_violations.len() + link_violations.len();
            for v in &outcome_violations {
                println!("OUTCOME VIOLATION [{}] {}: {} — {}", v.source, v.id, v.outcome_str, v.reason);
            }
            for v in &link_violations {
                println!("LINK VIOLATION [{}] {}: missing attractor '{}'", v.source, v.id, v.missing_attractor_id);
            }
            if total == 0 {
                println!("OK: all checks passed.");
            } else {
                bail!("{} total violation(s) found.", total);
            }
        }
        VerifyCheck::CommitMsg { .. } => {
            anyhow::bail!("verify commit-msg is handled by the CLI dispatcher; call residual verify commit-msg directly");
        }
    }
    Ok(())
}

pub fn check_outcomes(cfg: &Config) -> Result<Vec<OutcomeViolation>> {
    let stressors = crate::storage::stressors::load(&cfg.residual_dir)?;
    let purposes = crate::storage::purposes::load(&cfg.residual_dir)?;
    let terms = crate::storage::terminology::load(&cfg.residual_dir)?;
    let term_set = crate::storage::terminology::term_set(&terms);

    let mut violations = Vec::new();

    for stressor in &stressors {
        for raw_outcome in stressor.outcomes.split('|') {
            let raw_outcome = raw_outcome.trim();
            if raw_outcome.is_empty() {
                continue;
            }
            match parse_outcome(raw_outcome) {
                None => {
                    violations.push(OutcomeViolation {
                        source: "stressor".to_string(),
                        id: stressor.id.clone(),
                        outcome_str: raw_outcome.to_string(),
                        reason: "outcome must have at least subject verb predicate (3 words)".to_string(),
                    });
                }
                Some(parts) => {
                    if !outcome_uses_terminology(&parts, &term_set) {
                        violations.push(OutcomeViolation {
                            source: "stressor".to_string(),
                            id: stressor.id.clone(),
                            outcome_str: raw_outcome.to_string(),
                            reason: "no word in this outcome matches the project terminology".to_string(),
                        });
                    }
                }
            }
        }
    }

    for purpose in &purposes {
        for raw_outcome in purpose.outcomes.split('|') {
            let raw_outcome = raw_outcome.trim();
            if raw_outcome.is_empty() {
                continue;
            }
            match parse_outcome(raw_outcome) {
                None => {
                    violations.push(OutcomeViolation {
                        source: "purpose".to_string(),
                        id: purpose.id.clone(),
                        outcome_str: raw_outcome.to_string(),
                        reason: "outcome must have at least subject verb predicate (3 words)".to_string(),
                    });
                }
                Some(parts) => {
                    if !outcome_uses_terminology(&parts, &term_set) {
                        violations.push(OutcomeViolation {
                            source: "purpose".to_string(),
                            id: purpose.id.clone(),
                            outcome_str: raw_outcome.to_string(),
                            reason: "no word in this outcome matches the project terminology".to_string(),
                        });
                    }
                }
            }
        }
    }

    Ok(violations)
}

pub fn check_links(cfg: &Config) -> Result<Vec<LinkViolation>> {
    let stressors = crate::storage::stressors::load(&cfg.residual_dir)?;
    let purposes = crate::storage::purposes::load(&cfg.residual_dir)?;
    let attractors = crate::storage::attractors::load(&cfg.residual_dir)?;
    let attractor_ids: std::collections::HashSet<String> =
        attractors.iter().map(|a| a.id.clone()).collect();

    let mut violations = Vec::new();

    for stressor in &stressors {
        if !stressor.attractor_id.is_empty() && !attractor_ids.contains(&stressor.attractor_id) {
            violations.push(LinkViolation {
                source: "stressor".to_string(),
                id: stressor.id.clone(),
                missing_attractor_id: stressor.attractor_id.clone(),
            });
        }
    }

    for purpose in &purposes {
        if !purpose.attractor_id.is_empty() && !attractor_ids.contains(&purpose.attractor_id) {
            violations.push(LinkViolation {
                source: "purpose".to_string(),
                id: purpose.id.clone(),
                missing_attractor_id: purpose.attractor_id.clone(),
            });
        }
    }

    Ok(violations)
}

/// Parse an outcome string into (subject, verb, predicates).
/// Format: "<subject> <verb> <pred1> [<pred2>...]"
/// Returns None if fewer than 3 words.
pub fn parse_outcome(outcome_str: &str) -> Option<OutcomeParts> {
    let words: Vec<&str> = outcome_str.split_whitespace().collect();
    if words.len() < 3 {
        return None;
    }
    let subject = words[0].to_string();
    let verb = words[1].to_string();
    let predicate = words[2..].join(" ");
    Some(OutcomeParts {
        subject,
        verb,
        predicates: vec![predicate],
    })
}

pub struct OutcomeParts {
    pub subject: String,
    pub verb: String,
    pub predicates: Vec<String>,
}

pub struct OutcomeViolation {
    pub source: String,
    pub id: String,
    pub outcome_str: String,
    pub reason: String,
}

pub struct LinkViolation {
    pub source: String,
    pub id: String,
    pub missing_attractor_id: String,
}

/// Check if any word in the outcome touches the terminology set.
pub fn outcome_uses_terminology(
    parts: &OutcomeParts,
    term_set: &std::collections::HashSet<String>,
) -> bool {
    if term_set.contains(&parts.subject.to_lowercase()) {
        return true;
    }
    if term_set.contains(&parts.verb.to_lowercase()) {
        return true;
    }
    for predicate in &parts.predicates {
        for word in predicate.split_whitespace() {
            if term_set.contains(&word.to_lowercase()) {
                return true;
            }
        }
    }
    false
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

    #[test]
    fn parse_outcome_basic() {
        let parts = parse_outcome("system handles auth via tokens").unwrap();
        assert_eq!(parts.subject, "system");
        assert_eq!(parts.verb, "handles");
        assert!(
            parts.predicates.iter().any(|p| p.contains("auth")),
            "predicates should contain 'auth', got {:?}",
            parts.predicates
        );
    }

    #[test]
    fn parse_outcome_empty_returns_none() {
        assert!(parse_outcome("").is_none());
    }

    #[test]
    fn outcome_uses_terminology_match() {
        let parts = OutcomeParts {
            subject: "system".to_string(),
            verb: "handles".to_string(),
            predicates: vec!["auth".to_string()],
        };
        let mut terms = HashSet::new();
        terms.insert("auth".to_string());
        assert!(outcome_uses_terminology(&parts, &terms));
    }

    #[test]
    fn outcome_uses_terminology_no_match() {
        let parts = OutcomeParts {
            subject: "system".to_string(),
            verb: "does".to_string(),
            predicates: vec!["something".to_string()],
        };
        let mut terms = HashSet::new();
        terms.insert("auth".to_string());
        assert!(!outcome_uses_terminology(&parts, &terms));
    }

    #[test]
    fn check_outcomes_empty_terminology_does_not_error() {
        let dir = tempdir().unwrap();
        let cfg = cfg_for(dir.path());
        stressors::append(
            dir.path(),
            stressors::Stressor {
                id: "S-01".to_string(),
                description: "test stressor".to_string(),
                attractor_id: "A-01".to_string(),
                naive_change: "none".to_string(),
                outcomes: "system handles auth".to_string(),
                components_affected: "auth".to_string(),
            },
        )
        .unwrap();
        let result = check_outcomes(&cfg);
        assert!(result.is_ok(), "check_outcomes should not error on empty terminology");
    }

    #[test]
    fn check_outcomes_valid_outcome_no_violations() {
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
        )
        .unwrap();
        stressors::append(
            dir.path(),
            stressors::Stressor {
                id: "S-01".to_string(),
                description: "test stressor".to_string(),
                attractor_id: "A-01".to_string(),
                naive_change: "none".to_string(),
                outcomes: "system handles auth".to_string(),
                components_affected: "auth".to_string(),
            },
        )
        .unwrap();
        let violations = check_outcomes(&cfg).unwrap();
        assert!(violations.is_empty(), "expected no violations for valid outcome");
    }

    #[test]
    fn check_outcomes_no_matching_term_is_violation() {
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
        )
        .unwrap();
        stressors::append(
            dir.path(),
            stressors::Stressor {
                id: "S-01".to_string(),
                description: "test stressor".to_string(),
                attractor_id: "A-01".to_string(),
                naive_change: "none".to_string(),
                outcomes: "widget frobs blorple".to_string(),
                components_affected: "widget".to_string(),
            },
        )
        .unwrap();
        let violations = check_outcomes(&cfg).unwrap();
        assert!(
            !violations.is_empty(),
            "expected violation for outcome with no terminology match"
        );
    }

    #[test]
    fn check_links_missing_attractor_is_violation() {
        let dir = tempdir().unwrap();
        let cfg = cfg_for(dir.path());
        stressors::append(
            dir.path(),
            stressors::Stressor {
                id: "S-01".to_string(),
                description: "test".to_string(),
                attractor_id: "A-99".to_string(),
                naive_change: "none".to_string(),
                outcomes: "system does x".to_string(),
                components_affected: "x".to_string(),
            },
        )
        .unwrap();
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
                description: "stable".to_string(),
                positive_state: "active".to_string(),
                negative_state: "unstable".to_string(),
            },
        )
        .unwrap();
        stressors::append(
            dir.path(),
            stressors::Stressor {
                id: "S-01".to_string(),
                description: "test".to_string(),
                attractor_id: "A-01".to_string(),
                naive_change: "none".to_string(),
                outcomes: "system does x".to_string(),
                components_affected: "x".to_string(),
            },
        )
        .unwrap();
        let violations = check_links(&cfg).unwrap();
        assert!(violations.is_empty(), "expected no violations when attractor exists");
    }

    #[test]
    fn verify_all_fails_when_outcomes_invalid() {
        let dir = tempdir().unwrap();
        let cfg = cfg_for(dir.path());
        terminology::append(
            dir.path(),
            terminology::Term {
                term: "operator".to_string(),
                definition: "human or agent".to_string(),
                domain: "tool".to_string(),
                related_terms: "".to_string(),
            },
        )
        .unwrap();
        stressors::append(
            dir.path(),
            stressors::Stressor {
                id: "S-01".to_string(),
                description: "test".to_string(),
                attractor_id: "A-01".to_string(),
                naive_change: "none".to_string(),
                outcomes: "widget frobs blorple".to_string(),
                components_affected: "x".to_string(),
            },
        )
        .unwrap();
        let err = run(&cfg, VerifyCheck::All).unwrap_err();
        assert!(
            err.to_string().contains("violation"),
            "expected verify all to fail, got {err}"
        );
    }
}
