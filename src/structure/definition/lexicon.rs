//! Lexicon schema — terms (+ aliases). Continuity: ≥1 terminology word in each
//! force outcome AND ≥1 in each force shortname.

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

use crate::structure::analysis::force::Force;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Term {
    pub term: String,
    pub definition: String,
    pub domain: String,
    pub aliases: String,
}

impl Term {
    pub fn new(term: impl Into<String>, definition: impl Into<String>) -> Self {
        Self {
            term: term.into(),
            definition: definition.into(),
            domain: String::new(),
            aliases: String::new(),
        }
    }
}

fn text_uses_term(text: &str, terms: &[Term]) -> bool {
    let lower = text.to_lowercase();
    terms.iter().any(|t| {
        let term = t.term.to_lowercase();
        if term.is_empty() {
            return false;
        }
        lower.contains(&term)
            || t.aliases
                .split('|')
                .map(str::trim)
                .filter(|a| !a.is_empty())
                .any(|a| lower.contains(&a.to_lowercase()))
    })
}

/// Lexicon continuity: every outcome and the shortname must reference ≥1 term.
pub fn check_force_lexicon_continuity(force: &Force, terms: &[Term]) -> Result<()> {
    if !text_uses_term(&force.shortname, terms) {
        bail!(
            "force '{}' shortname '{}' must contain ≥1 terminology word",
            force.id,
            force.shortname
        );
    }
    for (i, outcome) in force.outcomes.iter().enumerate() {
        if !text_uses_term(outcome, terms) {
            bail!(
                "force '{}' outcome[{}] must contain ≥1 terminology word: '{}'",
                force.id,
                i,
                outcome
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::structure::analysis::force::Force;

    #[test]
    fn lexicon_requires_term_in_outcome_and_shortname() {
        let terms = vec![
            Term::new("residue", "force + component mapping"),
            Term::new("attractor", "stable system state"),
        ];
        let ok = Force::purpose(
            "P-01",
            "residue-map",
            "map without traits",
            vec!["operator records a residue against an attractor".into()],
        );
        assert!(check_force_lexicon_continuity(&ok, &terms).is_ok());

        let bad_short = Force::purpose(
            "P-02",
            "xyzzy",
            "map without traits",
            vec!["operator records a residue against an attractor".into()],
        );
        assert!(check_force_lexicon_continuity(&bad_short, &terms).is_err());

        let bad_outcome = Force::purpose(
            "P-03",
            "residue-map",
            "map without traits",
            vec!["operator does a thing".into()],
        );
        assert!(check_force_lexicon_continuity(&bad_outcome, &terms).is_err());
    }
}
