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
    let path = residual_dir.join("terminology.csv");
    if !path.exists() {
        return Ok(vec![]);
    }
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_path(&path)?;
    let mut result = Vec::new();
    for record in rdr.deserialize() {
        let t: Term = record?;
        result.push(t);
    }
    Ok(result)
}

pub fn append(residual_dir: &Path, term: Term) -> Result<()> {
    let path = residual_dir.join("terminology.csv");
    let file_exists = path.exists() && std::fs::metadata(&path).map(|m| m.len() > 0).unwrap_or(false);
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    if !file_exists {
        writeln!(file, "term,definition,domain,related_terms")?;
    }
    let mut buf = Vec::new();
    {
        let mut wtr = csv::WriterBuilder::new()
            .has_headers(false)
            .from_writer(&mut buf);
        wtr.write_record(&[
            &term.term,
            &term.definition,
            &term.domain,
            &term.related_terms,
        ])?;
        wtr.flush()?;
    }
    file.write_all(&buf)?;
    Ok(())
}

pub fn term_set(terms: &[Term]) -> std::collections::HashSet<String> {
    terms.iter().map(|t| t.term.to_lowercase()).collect()
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
