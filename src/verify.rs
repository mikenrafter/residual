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
