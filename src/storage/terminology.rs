use anyhow::Result;
use std::path::Path;

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
