//! Commit message validation — lexicon/component vocabulary in git subjects.
//!
//! Body lines are never validated. Enforcement is opt-in via storage-config
//! (`commit_msg_enforce`); hook install warns by default.

use anyhow::{bail, Context, Result};
use regex::Regex;
use std::collections::HashSet;
use std::path::Path;

use crate::config::Config;
use crate::storage::config::StorageConfig;
use crate::storage::format;
use crate::structure::definition::components;

const CONVENTIONAL_TYPES: &[&str] = &[
    "build", "chore", "ci", "docs", "feat", "fix", "perf", "refactor", "revert", "style", "test",
];

const GENERAL_PREFIX: &str = "general - ";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommitMsgVerdict {
    Ok,
    Warn(Vec<String>),
    Violation(Vec<String>),
}

impl CommitMsgVerdict {
    pub fn messages(&self) -> &[String] {
        match self {
            Self::Ok => &[],
            Self::Warn(v) | Self::Violation(v) => v.as_slice(),
        }
    }

    pub fn is_ok(&self) -> bool {
        matches!(self, Self::Ok)
    }
}

#[derive(Debug, Clone)]
pub struct Vocabulary {
    phrases: Vec<String>,
    components: Vec<String>,
    force_ids: HashSet<String>,
}

pub fn load_vocabulary(residual_dir: &Path) -> Result<Vocabulary> {
    let mut phrases = HashSet::new();

    for term in format::read_lexicon(residual_dir)? {
        add_phrases(&mut phrases, &term.term);
        for alias in term.aliases.split('|') {
            add_phrases(&mut phrases, alias);
        }
    }

    let mut phrase_vec: Vec<String> = phrases.into_iter().collect();
    phrase_vec.sort_by_key(|p| std::cmp::Reverse(p.len()));

    let component_list = components::load(residual_dir)?
        .into_iter()
        .map(|c| c.name.to_lowercase())
        .collect::<Vec<_>>();

    let force_ids: HashSet<String> = crate::storage::stressors::load(residual_dir)?
        .into_iter()
        .map(|s| s.id)
        .chain(crate::storage::purposes::load(residual_dir)?.into_iter().map(|p| p.id))
        .collect();

    Ok(Vocabulary {
        phrases: phrase_vec,
        components: component_list,
        force_ids,
    })
}

fn add_phrases(set: &mut HashSet<String>, raw: &str) {
    let trimmed = raw.trim().to_lowercase();
    if trimmed.is_empty() {
        return;
    }
    set.insert(trimmed.clone());
    for token in trimmed.split_whitespace() {
        if token.len() >= 3 {
            set.insert(token.to_string());
        }
    }
}

pub fn subject_line(message: &str) -> &str {
    message.lines().next().unwrap_or("").trim()
}

pub fn check_subject(subject: &str, vocab: &Vocabulary, super_strict: bool) -> CommitMsgVerdict {
    let subject = subject.trim();
    if subject.is_empty() {
        return CommitMsgVerdict::Violation(vec!["commit subject is empty".into()]);
    }

    let lower = subject.to_lowercase();
    let mut notes = Vec::new();

    if let Some(kind) = conventional_prefix(&lower) {
        return CommitMsgVerdict::Violation(vec![format!(
            "conventional commit prefix '{kind}:' is not allowed — use a lexicon term, component name, or '{GENERAL_PREFIX}'"
        )]);
    }

    if lower.starts_with(GENERAL_PREFIX) {
        return CommitMsgVerdict::Ok;
    }

    if let Some((component, force_id, _summary)) = parse_force_subject(subject) {
        let mut problems = Vec::new();
        if !vocab.components.iter().any(|c| c == &component) {
            problems.push(format!("unknown component '{component}'"));
        }
        if !vocab.force_ids.contains(&force_id) {
            problems.push(format!("unknown force id '{force_id}'"));
        }
        if problems.is_empty() {
            return CommitMsgVerdict::Ok;
        }
        return CommitMsgVerdict::Violation(problems);
    }

    if super_strict {
        return CommitMsgVerdict::Violation(vec![format!(
            "super_strict requires '<component>: S-<nn>: summary' or '<component>: P-<nn>: summary' or subject starting with '{GENERAL_PREFIX}'"
        )]);
    }

    if text_uses_vocabulary(&lower, vocab) {
        return CommitMsgVerdict::Ok;
    }

    notes.push(format!(
        "subject does not contain a lexicon term or component name — prefer '<component>: S-<nn>:' or start with '{GENERAL_PREFIX}'"
    ));
    CommitMsgVerdict::Violation(notes)
}

fn conventional_prefix(lower_subject: &str) -> Option<&'static str> {
    for kind in CONVENTIONAL_TYPES {
        let bare = format!("{kind}:");
        if lower_subject.starts_with(&bare) {
            return Some(kind);
        }
        let scoped = format!("{kind}(");
        if lower_subject.starts_with(&scoped) && lower_subject.contains("):") {
            return Some(kind);
        }
    }
    None
}

/// `<component>: S-12: summary` or `<component>: P-04: summary`
pub fn parse_force_subject(subject: &str) -> Option<(String, String, String)> {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"^([^:]+):\s*([SP]-\d+):\s*(.+)$").expect("force subject regex")
    });
    let caps = re.captures(subject.trim())?;
    Some((
        caps.get(1)?.as_str().trim().to_lowercase(),
        caps.get(2)?.as_str().to_uppercase(),
        caps.get(3)?.as_str().trim().to_string(),
    ))
}

pub fn text_uses_vocabulary(lower_subject: &str, vocab: &Vocabulary) -> bool {
    for component in &vocab.components {
        if lower_subject.contains(component) {
            return true;
        }
    }
    for phrase in &vocab.phrases {
        if phrase.len() >= 3 && lower_subject.contains(phrase) {
            return true;
        }
    }
    false
}

pub fn staged_component_hints(staged_paths: &[String], vocab: &Vocabulary) -> Vec<String> {
    let mut hits = HashSet::new();
    for path in staged_paths {
        let path_lower = path.to_lowercase();
        for component in &vocab.components {
            if path_lower.contains(component) {
                hits.insert(component.clone());
            }
        }
    }
    let mut out: Vec<String> = hits.into_iter().collect();
    out.sort();
    out
}

pub fn suggest_subjects(
    cfg: &Config,
    staged_paths: &[String],
) -> Result<Vec<String>> {
    let vocab = load_vocabulary(&cfg.residual_dir)?;
    let hints = staged_component_hints(staged_paths, &vocab);
    let stressors = crate::storage::stressors::load(&cfg.residual_dir)?;
    let purposes = crate::storage::purposes::load(&cfg.residual_dir)?;
    let residues = format::read_residues(&cfg.residual_dir)?;

    let mut suggestions = Vec::new();

    for component in &hints {
        let mut added = false;
        for residue in residues
            .iter()
            .filter(|r| r.component_id.eq_ignore_ascii_case(component))
        {
            let shortname = stressors
                .iter()
                .find(|s| s.id == residue.force_id)
                .map(|s| s.shortname.as_str())
                .or_else(|| purposes.iter().find(|p| p.id == residue.force_id).map(|p| p.shortname.as_str()));
            if let Some(sn) = shortname {
                let prefix = residue.force_id.to_uppercase();
                let summary = sn.replace('-', " ");
                suggestions.push(format!("{component}: {prefix}: {summary}"));
                added = true;
            }
        }
        if !added {
            suggestions.push(format!("{component}: short summary here"));
        }
    }

    if suggestions.is_empty() && !hints.is_empty() {
        for component in hints {
            suggestions.push(format!("{component}: short summary here"));
        }
    }

    if suggestions.is_empty() {
        suggestions.push(format!(
            "general - describe meta/tooling work, or use a lexicon term in the subject"
        ));
    }

    Ok(suggestions)
}

pub fn template_for_force(cfg: &Config, force_id: &str) -> Result<String> {
    let force_id = force_id.to_uppercase();
    let stressors = crate::storage::stressors::load(&cfg.residual_dir)?;
    let purposes = crate::storage::purposes::load(&cfg.residual_dir)?;

    let (canonical_id, shortname) = if let Some(s) = stressors.iter().find(|s| s.id.eq_ignore_ascii_case(&force_id)) {
        (s.id.clone(), s.shortname.clone())
    } else if let Some(p) = purposes.iter().find(|p| p.id.eq_ignore_ascii_case(&force_id)) {
        (p.id.clone(), p.shortname.clone())
    } else {
        anyhow::bail!("force '{force_id}' not found in stressors or purposes");
    };

    let residues = format::read_residues(&cfg.residual_dir)?;
    let component = residues
        .iter()
        .find(|r| r.force_id.eq_ignore_ascii_case(&canonical_id))
        .map(|r| r.component_id.as_str())
        .unwrap_or("component-name");

    let summary = shortname.replace('-', " ");
    Ok(format!(
        "{component}: {}: {summary}\n\n- \n- \n",
        canonical_id.to_uppercase()
    ))
}

pub fn verify_message(
    cfg: &Config,
    policy: &StorageConfig,
    message: &str,
    staged_paths: &[String],
) -> Result<CommitMsgVerdict> {
    let subject = subject_line(message);
    let vocab = load_vocabulary(&cfg.residual_dir)?;
    let mut verdict = check_subject(subject, &vocab, policy.super_strict);

    if !staged_paths.is_empty() {
        let hints = staged_component_hints(staged_paths, &vocab);
        if !hints.is_empty() && !verdict.is_ok() {
            if let CommitMsgVerdict::Violation(ref mut msgs) = verdict {
                msgs.push(format!(
                    "staged paths touch component(s): {} — consider a force-responsive subject",
                    hints.join(", ")
                ));
            }
        } else if !hints.is_empty() {
            let mentioned: HashSet<_> = hints
                .iter()
                .filter(|c| subject.to_lowercase().contains(c.as_str()))
                .cloned()
                .collect();
            if mentioned.is_empty() {
                let note = format!(
                    "staged paths touch {} but subject does not — optional hint",
                    hints.join(", ")
                );
                verdict = match verdict {
                    CommitMsgVerdict::Ok => CommitMsgVerdict::Warn(vec![note]),
                    CommitMsgVerdict::Warn(mut w) => {
                        w.push(note);
                        CommitMsgVerdict::Warn(w)
                    }
                    CommitMsgVerdict::Violation(mut v) => {
                        v.push(note);
                        CommitMsgVerdict::Violation(v)
                    }
                };
            }
        }
    }

    Ok(verdict)
}

pub fn run_verify(
    cfg: &Config,
    message: &str,
    staged_paths: &[String],
    enforce_override: Option<bool>,
) -> Result<()> {
    let policy = crate::verification::policy_from_storage_config(&cfg.residual_dir)?;
    let enforce = enforce_override.unwrap_or(policy.commit_msg_enforce);
    let verdict = verify_message(cfg, &policy, message, staged_paths)?;

    match &verdict {
        CommitMsgVerdict::Ok => {
            println!("OK: commit subject uses project vocabulary.");
        }
        CommitMsgVerdict::Warn(msgs) => {
            for msg in msgs {
                println!("WARN: {msg}");
            }
            println!("OK (warn-only): commit-msg enforcement is disabled.");
        }
        CommitMsgVerdict::Violation(msgs) => {
            for msg in msgs {
                println!("VIOLATION: {msg}");
            }
            if enforce {
                bail!("commit message rejected (commit_msg_enforce = true)");
            }
            println!("WARN (enforce disabled): {} violation(s) — hook would allow this commit.", msgs.len());
        }
    }
    Ok(())
}

pub fn git_staged_paths() -> Result<Vec<String>> {
    let out = std::process::Command::new("git")
        .args(["diff", "--cached", "--name-only"])
        .output()
        .context("run git diff --cached --name-only")?;
    if !out.status.success() {
        return Ok(vec![]);
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use crate::storage::format;
    use crate::structure::analysis::residues::Residue;
    use tempfile::tempdir;

    fn cfg_for(dir: &Path) -> Config {
        Config {
            validation: crate::config::ValidationConfig { strict: true },
            skills: crate::config::SkillsConfig { token_warn: 1000 },
            residual_dir: dir.to_path_buf(),
        }
    }

    fn seed_vocab(dir: &Path) {
        use crate::structure::definition::lexicon::Term;
        format::write_lexicon(
            dir,
            &[Term {
                term: "residue".into(),
                definition: "mapping".into(),
                domain: "nkp".into(),
                aliases: "residual-architecture".into(),
            }],
        )
        .unwrap();
        std::fs::write(
            dir.join("components.csv"),
            "name,description,status,architecture_set\nverification-git-hook,hook,proposed,test\ncli,cli,proposed,test\n",
        )
        .unwrap();
        crate::storage::stressors::append(
            dir,
            crate::storage::stressors::Stressor {
                id: "S-28".into(),
                shortname: "lexicon-commit-drift".into(),
                description: "commit msg hook drift".into(),
                attractor_id: "".into(),
                naive_change: "add commit-msg hook".into(),
                outcomes: "git hook enforces lexicon continuity".into(),
                components: "verification-git-hook".into(),
            },
        )
        .unwrap();
    }

    #[test]
    fn general_prefix_always_passes() {
        let dir = tempdir().unwrap();
        seed_vocab(dir.path());
        let vocab = load_vocabulary(dir.path()).unwrap();
        assert!(check_subject("general - bump deps", &vocab, true).is_ok());
    }

    #[test]
    fn conventional_commit_rejected() {
        let dir = tempdir().unwrap();
        seed_vocab(dir.path());
        let vocab = load_vocabulary(dir.path()).unwrap();
        let v = check_subject("fix: something broke", &vocab, false);
        assert!(matches!(v, CommitMsgVerdict::Violation(_)));
    }

    #[test]
    fn force_subject_parsed_and_validated() {
        let dir = tempdir().unwrap();
        seed_vocab(dir.path());
        let vocab = load_vocabulary(dir.path()).unwrap();
        assert!(check_subject(
            "verification-git-hook: S-28: commit-msg validation",
            &vocab,
            false
        )
        .is_ok());
    }

    #[test]
    fn alias_aware_lexicon_match() {
        let dir = tempdir().unwrap();
        seed_vocab(dir.path());
        let vocab = load_vocabulary(dir.path()).unwrap();
        assert!(check_subject(
            "expand residual-architecture notes",
            &vocab,
            false
        )
        .is_ok());
    }

    #[test]
    fn super_strict_requires_force_or_general() {
        let dir = tempdir().unwrap();
        seed_vocab(dir.path());
        let vocab = load_vocabulary(dir.path()).unwrap();
        assert!(!check_subject("residue mapping tweak", &vocab, true).is_ok());
        assert!(check_subject(
            "verification-git-hook: S-28: hook wiring",
            &vocab,
            true
        )
        .is_ok());
    }

    #[test]
    fn template_for_force_uses_residue_component() {
        let dir = tempdir().unwrap();
        seed_vocab(dir.path());
        format::write_residues(
            dir.path(),
            &[{
                let mut r = Residue::new("R-1", "S-28", "verification-git-hook");
                r.status = "active".to_string();
                r
            }],
        )
        .unwrap();
        let cfg = cfg_for(dir.path());
        let tpl = template_for_force(&cfg, "S-28").unwrap();
        assert!(tpl.contains("verification-git-hook: S-28:"));
    }
}
