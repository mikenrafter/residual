//! A-02 Terminology Drift — S-12 lexicon alias matching in outcome validation.

use std::process::Command;
use tempfile::TempDir;

fn run(dir: &TempDir, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_residual"))
        .args(args)
        .current_dir(dir.path())
        .output()
        .expect("run residual")
}

fn init(dir: &TempDir) {
    let out = run(dir, &["init"]);
    assert!(out.status.success(), "init failed: {}", String::from_utf8_lossy(&out.stderr));
}

#[test]
fn s12_outcome_accepts_lexicon_alias_word() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    std::fs::write(
        dir.path().join("residual/lexicon.csv"),
        "term,definition,domain,aliases\n\
         family,kin grouping,core,families\n",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("residual/stressors.csv"),
        "id,description,naive_change,outcomes,components_affected,attractor_id\n\
         S-99,desc,none,operator defines families correctly,core,A-01\n",
    )
    .unwrap();
    let out = run(&dir, &["verify", "outcomes"]);
    assert!(
        out.status.success(),
        "alias 'families' should satisfy outcome verify; stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn s12_outcome_accepts_hyphenated_lexicon_alias() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    std::fs::write(
        dir.path().join("residual/lexicon.csv"),
        "term,definition,domain,aliases\n\
         example,canonical form,core,hyphenated-example|example-with-dash\n",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("residual/stressors.csv"),
        "id,description,naive_change,outcomes,components_affected,attractor_id\n\
         S-99,desc,none,operator records hyphenated-example usage,core,A-01\n",
    )
    .unwrap();
    let out = run(&dir, &["verify", "outcomes"]);
    assert!(
        out.status.success(),
        "hyphenated alias should match; stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn s12_outcome_accepts_multi_word_phrase_alias() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    std::fs::write(
        dir.path().join("residual/lexicon.csv"),
        "term,definition,domain,aliases\n\
         example,canonical form,core,this example has a dash in it\n",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("residual/stressors.csv"),
        "id,description,naive_change,outcomes,components_affected,attractor_id\n\
         S-99,desc,none,operator cites this example has a dash in it here,core,A-01\n",
    )
    .unwrap();
    let out = run(&dir, &["verify", "outcomes"]);
    assert!(
        out.status.success(),
        "multi-word phrase alias should match via substring; stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn s12_outcome_accepts_lexicon_related_term_alias() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    // terminology.csv is fully replaced by lexicon.csv — write directly to lexicon
    std::fs::write(
        dir.path().join("residual/lexicon.csv"),
        "term,definition,domain,aliases\n\
         family,kin grouping,core,families\n",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("residual/stressors.csv"),
        "id,description,naive_change,outcomes,components_affected,attractor_id\n\
         S-99,desc,none,operator defines families correctly,core,A-01\n",
    )
    .unwrap();
    let out = run(&dir, &["verify", "outcomes"]);
    assert!(
        out.status.success(),
        "lexicon alias should match; stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );
}
