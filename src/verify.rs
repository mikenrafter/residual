use anyhow::{bail, Result};
use std::time::{Duration, Instant};
use crate::config::Config;
use crate::cli::VerifyCheck;

pub const OUTCOME_VERIFY_SLOW_SECS: u64 = 2;

pub fn slow_outcome_verify_warning(elapsed: Duration) -> Option<String> {
    if elapsed.as_secs() >= OUTCOME_VERIFY_SLOW_SECS {
        Some(format!(
            "WARN: outcome validation took {:.2}s (≥{}s) — slow verify may drive hook bypass (S-06)",
            elapsed.as_secs_f64(),
            OUTCOME_VERIFY_SLOW_SECS
        ))
    } else {
        None
    }
}

fn print_slow_outcome_warning(elapsed: Duration) {
    if let Some(warn) = slow_outcome_verify_warning(elapsed) {
        println!("{warn}");
    }
}

pub fn run(cfg: &Config, check: VerifyCheck) -> Result<()> {
    match check {
        VerifyCheck::Outcomes => {
            let started = Instant::now();
            let violations = check_outcomes(cfg)?;
            print_slow_outcome_warning(started.elapsed());
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
                    println!("VIOLATION [{}] {}: {}", v.source, v.id, v.message);
                }
                bail!("{} link violation(s) found.", violations.len());
            }
        }
        VerifyCheck::All => {
            let started = Instant::now();
            let outcome_violations = check_outcomes(cfg)?;
            print_slow_outcome_warning(started.elapsed());
            let link_violations = check_links(cfg)?;
            let total = outcome_violations.len() + link_violations.len();
            for v in &outcome_violations {
                println!("OUTCOME VIOLATION [{}] {}: {} — {}", v.source, v.id, v.outcome_str, v.reason);
            }
            for v in &link_violations {
                println!("LINK VIOLATION [{}] {}: {}", v.source, v.id, v.message);
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
    let term_index = crate::storage::terminology::term_index(&cfg.residual_dir)?;

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
                    if !outcome_uses_terminology(raw_outcome, &parts, &term_index) {
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
                    if !outcome_uses_terminology(raw_outcome, &parts, &term_index) {
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
                message: format!("missing attractor '{}'", stressor.attractor_id),
            });
        }
        if stressor.shortname.is_empty() {
            violations.push(LinkViolation {
                source: "stressor".to_string(),
                id: stressor.id.clone(),
                message: "missing shortname (use --shortname when adding)".to_string(),
            });
        }
    }

    for purpose in &purposes {
        if !purpose.attractor_id.is_empty() && !attractor_ids.contains(&purpose.attractor_id) {
            violations.push(LinkViolation {
                source: "purpose".to_string(),
                id: purpose.id.clone(),
                message: format!("missing attractor '{}'", purpose.attractor_id),
            });
        }
        if purpose.shortname.is_empty() {
            violations.push(LinkViolation {
                source: "purpose".to_string(),
                id: purpose.id.clone(),
                message: "missing shortname (use --shortname when adding)".to_string(),
            });
        }
    }

    let forces = crate::storage::format::read_forces(&cfg.residual_dir)?;
    let residues = crate::storage::format::read_residues(&cfg.residual_dir)?;
    let registry = crate::structure::definition::components::load(&cfg.residual_dir)?;
    let mut force_ids = std::collections::HashSet::new();
    for s in &stressors {
        force_ids.insert(s.id.clone());
    }
    for p in &purposes {
        force_ids.insert(p.id.clone());
    }
    for f in &forces {
        force_ids.insert(f.id.clone());
    }
    let component_names: std::collections::HashSet<String> =
        registry.iter().map(|c| c.name.clone()).collect();

    for force in &forces {
        if !force.attractor_id.is_empty() && !attractor_ids.contains(&force.attractor_id) {
            violations.push(LinkViolation {
                source: "force".to_string(),
                id: force.id.clone(),
                message: format!("missing attractor '{}'", force.attractor_id),
            });
        }
    }

    for residue in &residues {
        if !residue.force_id.is_empty() && !force_ids.contains(&residue.force_id) {
            violations.push(LinkViolation {
                source: "residue".to_string(),
                id: residue.id.clone(),
                message: format!("force_id '{}' not found", residue.force_id),
            });
        }
        // whole-system-residue uses a virtual component outside the registry (A-07).
        if crate::structure::analysis::residues::is_whole_system_residue(residue) {
            continue;
        }
        if !residue.component_id.is_empty() && !component_names.contains(&residue.component_id) {
            violations.push(LinkViolation {
                source: "residue".to_string(),
                id: residue.id.clone(),
                message: format!(
                    "component_id '{}' not found in components.csv",
                    residue.component_id
                ),
            });
        }
    }

    Ok(violations)
}

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
    pub message: String,
}

/// Check if any word or phrase in the outcome touches the terminology index.
pub fn outcome_uses_terminology(
    outcome_str: &str,
    parts: &OutcomeParts,
    index: &crate::storage::terminology::TermIndex,
) -> bool {
    if index.words.contains(&parts.subject.to_lowercase()) {
        return true;
    }
    if index.words.contains(&parts.verb.to_lowercase()) {
        return true;
    }
    for predicate in &parts.predicates {
        for word in predicate.split_whitespace() {
            if index.words.contains(&word.to_lowercase()) {
                return true;
            }
        }
    }
    let lower = outcome_str.to_lowercase();
    for phrase in &index.phrases {
        if phrase.len() >= 3 && lower.contains(phrase.as_str()) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use crate::config::Config;
    use crate::storage::stressors;
    use crate::storage::attractors;
    use crate::storage::terminology;
    use crate::structure::analysis::residues::Residue;

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
        let index = terminology::TermIndex {
            words: ["auth".to_string()].into_iter().collect(),
            phrases: vec![],
        };
        assert!(outcome_uses_terminology("system handles auth", &parts, &index));
    }

    #[test]
    fn outcome_uses_terminology_no_match() {
        let parts = OutcomeParts {
            subject: "system".to_string(),
            verb: "does".to_string(),
            predicates: vec!["something".to_string()],
        };
        let index = terminology::TermIndex {
            words: ["auth".to_string()].into_iter().collect(),
            phrases: vec![],
        };
        assert!(!outcome_uses_terminology("system does something", &parts, &index));
    }

    #[test]
    fn outcome_uses_terminology_phrase_alias_match() {
        let parts = OutcomeParts {
            subject: "operator".to_string(),
            verb: "cites".to_string(),
            predicates: vec!["this example has a dash in it here".to_string()],
        };
        let index = terminology::TermIndex {
            words: std::collections::HashSet::new(),
            phrases: vec!["this example has a dash in it".to_string()],
        };
        assert!(outcome_uses_terminology(
            "operator cites this example has a dash in it here",
            &parts,
            &index
        ));
    }

    #[test]
    fn outcome_uses_terminology_phrase_match() {
        let parts = OutcomeParts {
            subject: "operator".to_string(),
            verb: "reads".to_string(),
            predicates: vec!["commit history using defined outcome".to_string()],
        };
        let index = terminology::TermIndex {
            words: ["operator".to_string(), "reads".to_string()].into_iter().collect(),
            phrases: vec!["defined outcome".to_string()],
        };
        assert!(outcome_uses_terminology(
            "operator reads commit history using defined outcome",
            &parts,
            &index
        ));
    }

    #[test]
    fn slow_outcome_verify_warning_emits_at_threshold() {
        let msg = slow_outcome_verify_warning(Duration::from_secs(2)).unwrap();
        assert!(msg.contains("WARN"));
        assert!(msg.contains("S-06"));
    }

    #[test]
    fn slow_outcome_verify_warning_silent_below_threshold() {
        assert!(slow_outcome_verify_warning(Duration::from_millis(500)).is_none());
    }

    #[test]
    fn check_outcomes_empty_terminology_does_not_error() {
        let dir = tempdir().unwrap();
        let cfg = cfg_for(dir.path());
        stressors::append(
            dir.path(),
            stressors::Stressor {
                id: "S-01".to_string(),
                shortname: String::new(),
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
                shortname: String::new(),
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
                shortname: String::new(),
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
                shortname: String::new(),
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
        assert_eq!(violations[0].message, "missing attractor 'A-99'");
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
                shortname: "auth-overload".to_string(),
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
    fn check_links_bad_residue_force_is_violation() {
        let dir = tempdir().unwrap();
        let cfg = cfg_for(dir.path());
        crate::storage::format::write_residues(
            dir.path(),
            &[Residue {
                id: "R-01".to_string(),
                force_id: "S-99".to_string(),
                component_id: "cli".to_string(),
                status: "proposed".to_string(),
                notes: String::new(),
            }],
        )
        .unwrap();
        std::fs::write(
            dir.path().join("components.csv"),
            "name,description,status,architecture_set\ncli,desc,proposed,baseline\n",
        )
        .unwrap();
        let violations = check_links(&cfg).unwrap();
        assert!(violations.iter().any(|v| v.source == "residue" && v.message.contains("S-99")));
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
                shortname: String::new(),
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

    // --- shortname verify tests (RED: check_links does not yet flag empty shortnames) ---

    #[test]
    fn check_links_flags_empty_shortname_stressor() {
        let dir = tempdir().unwrap();
        let cfg = cfg_for(dir.path());
        attractors::append(
            dir.path(),
            attractors::Attractor {
                id: "A-01".to_string(),
                name: "Stability".to_string(),
                description: "stable".to_string(),
                positive_state: "coherent".to_string(),
                negative_state: "collapse".to_string(),
            },
        )
        .unwrap();
        stressors::append(
            dir.path(),
            stressors::Stressor {
                id: "S-01".to_string(),
                description: "stressor without shortname".to_string(),
                attractor_id: "A-01".to_string(),
                naive_change: "none".to_string(),
                outcomes: "system does x".to_string(),
                components_affected: "x".to_string(),
                shortname: "".to_string(),
            },
        )
        .unwrap();
        let violations = check_links(&cfg).unwrap();
        let shortname_violation = violations
            .iter()
            .find(|v| v.source == "stressor" && v.id == "S-01" && v.message.contains("shortname"));
        assert!(
            shortname_violation.is_some(),
            "expected a shortname violation for S-01 with empty shortname, got: {:?}",
            violations.iter().map(|v| format!("[{}] {}: {}", v.source, v.id, v.message)).collect::<Vec<_>>()
        );
    }

    #[test]
    fn check_links_passes_nonempty_shortname() {
        let dir = tempdir().unwrap();
        let cfg = cfg_for(dir.path());
        attractors::append(
            dir.path(),
            attractors::Attractor {
                id: "A-01".to_string(),
                name: "Stability".to_string(),
                description: "stable".to_string(),
                positive_state: "coherent".to_string(),
                negative_state: "collapse".to_string(),
            },
        )
        .unwrap();
        stressors::append(
            dir.path(),
            stressors::Stressor {
                id: "S-01".to_string(),
                description: "stressor with shortname".to_string(),
                attractor_id: "A-01".to_string(),
                naive_change: "none".to_string(),
                outcomes: "system does x".to_string(),
                components_affected: "x".to_string(),
                shortname: "cli-bypass".to_string(),
            },
        )
        .unwrap();
        let violations = check_links(&cfg).unwrap();
        let shortname_violation = violations
            .iter()
            .find(|v| v.source == "stressor" && v.id == "S-01" && v.message.contains("shortname"));
        assert!(
            shortname_violation.is_none(),
            "expected no shortname violation for S-01 with non-empty shortname, got: {:?}",
            violations.iter().map(|v| format!("[{}] {}: {}", v.source, v.id, v.message)).collect::<Vec<_>>()
        );
    }
}
