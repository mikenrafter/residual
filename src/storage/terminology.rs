use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Term {
    pub term: String,
    pub definition: String,
    pub domain: String,
    pub related_terms: String,
}

pub fn load(residual_dir: &Path) -> Result<Vec<Term>> {
    todo!("load terminology.csv")
}

pub fn append(residual_dir: &Path, term: Term) -> Result<()> {
    todo!("append term to csv")
}

pub fn term_set(terms: &[Term]) -> std::collections::HashSet<String> {
    todo!("return lowercase set of all term strings")
}
