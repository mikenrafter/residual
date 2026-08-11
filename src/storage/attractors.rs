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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn make_attractor(id: &str) -> Attractor {
        Attractor {
            id: id.to_string(),
            name: "Stability".to_string(),
            valence: Valence::Positive,
            description: "System remains stable".to_string(),
            phase_state: "active".to_string(),
        }
    }

    #[test]
    fn next_id_empty() {
        assert_eq!(next_id(&[]), "A-01");
    }

    #[test]
    fn next_id_after_a03() {
        let attractors = vec![make_attractor("A-01"), make_attractor("A-03")];
        assert_eq!(next_id(&attractors), "A-04");
    }

    #[test]
    fn exists_returns_false_for_empty_csv() {
        let dir = tempdir().unwrap();
        assert!(!exists(dir.path(), "A-01").unwrap());
    }

    #[test]
    fn exists_returns_true_after_append() {
        let dir = tempdir().unwrap();
        append(dir.path(), make_attractor("A-01")).unwrap();
        assert!(exists(dir.path(), "A-01").unwrap());
    }

    #[test]
    fn valence_positive_parses() {
        let v: Valence = "positive".parse().unwrap();
        assert_eq!(v, Valence::Positive);
    }

    #[test]
    fn valence_negative_parses() {
        let v: Valence = "negative".parse().unwrap();
        assert_eq!(v, Valence::Negative);
    }

    #[test]
    fn valence_invalid_errors() {
        let result: Result<Valence> = "neutral".parse::<Valence>().map_err(|e| e.into());
        assert!(result.is_err());
    }

    #[test]
    fn attractor_round_trips() {
        let dir = tempdir().unwrap();
        let a = make_attractor("A-01");
        append(dir.path(), a).unwrap();
        let loaded = load(dir.path()).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "A-01");
        assert_eq!(loaded[0].valence, Valence::Positive);
        assert_eq!(loaded[0].name, "Stability");
    }

    #[test]
    fn load_missing_file_returns_empty() {
        let dir = tempdir().unwrap();
        let result = load(dir.path()).unwrap();
        assert!(result.is_empty());
    }
}
