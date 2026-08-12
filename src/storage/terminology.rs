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

#[derive(Debug, Clone)]
pub struct TermIndex {
    pub words: std::collections::HashSet<String>,
    pub phrases: Vec<String>,
}

fn add_index_tokens(
    words: &mut std::collections::HashSet<String>,
    phrases: &mut Vec<String>,
    raw: &str,
) {
    let trimmed = raw.trim().to_lowercase();
    if trimmed.is_empty() {
        return;
    }
    phrases.push(trimmed.clone());
    words.insert(trimmed.clone());
    for token in trimmed.split_whitespace() {
        if !token.is_empty() {
            words.insert(token.to_string());
        }
    }
}

pub fn term_index(residual_dir: &Path) -> Result<TermIndex> {
    let mut words = std::collections::HashSet::new();
    let mut phrases = Vec::new();

    for t in load(residual_dir)? {
        add_index_tokens(&mut words, &mut phrases, &t.term);
        for alias in t.related_terms.split('|') {
            add_index_tokens(&mut words, &mut phrases, alias);
        }
    }

    for t in crate::storage::format::read_lexicon(residual_dir)? {
        add_index_tokens(&mut words, &mut phrases, &t.term);
        for alias in t.aliases.split('|') {
            add_index_tokens(&mut words, &mut phrases, alias);
        }
    }

    phrases.sort_by_key(|p| std::cmp::Reverse(p.len()));
    phrases.dedup();

    Ok(TermIndex { words, phrases })
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
    fn term_index_merges_lexicon_and_related_term_aliases() {
        use crate::structure::definition::lexicon::Term as LexTerm;
        let dir = tempdir().unwrap();
        append(
            dir.path(),
            Term {
                term: "family".into(),
                definition: "kin".into(),
                domain: "core".into(),
                related_terms: "families".into(),
            },
        )
        .unwrap();
        crate::storage::format::write_lexicon(
            dir.path(),
            &[LexTerm {
                term: "residue".into(),
                definition: "mapping".into(),
                domain: "core".into(),
                aliases: "residual-map|residual-architecture".into(),
            }],
        )
        .unwrap();
        let index = term_index(dir.path()).unwrap();
        assert!(index.words.contains("family"));
        assert!(index.words.contains("families"));
        assert!(index.words.contains("residue"));
        assert!(index.words.contains("residual-map"));
        assert!(index.phrases.iter().any(|p| p.contains("residual-architecture")));
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
