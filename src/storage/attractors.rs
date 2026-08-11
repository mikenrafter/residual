use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attractor {
    pub id: String,
    pub name: String,
    pub valence: Valence,
    pub description: String,
    pub phase_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Valence {
    Positive,
    Negative,
}

impl std::str::FromStr for Valence {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Self> {
        match s.to_lowercase().as_str() {
            "positive" => Ok(Valence::Positive),
            "negative" => Ok(Valence::Negative),
            other => anyhow::bail!("invalid valence '{}': must be 'positive' or 'negative'", other),
        }
    }
}

impl std::fmt::Display for Valence {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Valence::Positive => write!(f, "positive"),
            Valence::Negative => write!(f, "negative"),
        }
    }
}

pub fn load(residual_dir: &Path) -> Result<Vec<Attractor>> {
    todo!("load attractors.csv")
}

pub fn append(residual_dir: &Path, attractor: Attractor) -> Result<()> {
    todo!("append attractor to csv")
}

pub fn next_id(attractors: &[Attractor]) -> String {
    todo!("generate next attractor id")
}

pub fn exists(residual_dir: &Path, id: &str) -> Result<bool> {
    todo!("check if attractor id exists")
}
