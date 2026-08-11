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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn make_term(term: &str) -> Term {
        Term {
            term: term.to_string(),
            definition: "a definition".to_string(),
            domain: "core".to_string(),
            related_terms: "".to_string(),
        }
    }

    #[test]
    fn term_set_empty_vec() {
        let set = term_set(&[]);
        assert!(set.is_empty());
    }

    #[test]
    fn term_set_contains_lowercase_terms() {
        let terms = vec![make_term("Attractor"), make_term("Stressor")];
        let set = term_set(&terms);
        assert!(set.contains("attractor"));
        assert!(set.contains("stressor"));
    }

    #[test]
    fn terminology_round_trips() {
        let dir = tempdir().unwrap();
        append(dir.path(), make_term("attractor")).unwrap();
        let loaded = load(dir.path()).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].term, "attractor");
    }

    #[test]
    fn load_missing_file_returns_empty() {
        let dir = tempdir().unwrap();
        let result = load(dir.path()).unwrap();
        assert!(result.is_empty());
    }
}
