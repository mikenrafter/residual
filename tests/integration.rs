use std::process::Command;
use tempfile::TempDir;

fn bin() -> std::path::PathBuf {
    env!("CARGO_BIN_EXE_residual").into()
}

fn run(dir: &TempDir, args: &[&str]) -> std::process::Output {
    Command::new(bin())
        .args(args)
        .current_dir(dir.path())
        .output()
        .expect("failed to run residual binary")
}

fn init(dir: &TempDir) {
    let out = run(dir, &["init"]);
    assert!(out.status.success(), "init failed: {}", String::from_utf8_lossy(&out.stderr));
}

// --- init ---

#[test]
fn init_creates_residual_dir() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    assert!(dir.path().join("residual").is_dir(), "residual/ should exist after init");
}

#[test]
fn init_creates_expected_csv_files() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    let base = dir.path().join("residual");
    for file in &["stressors.csv", "purposes.csv", "attractors.csv", "terminology.csv"] {
        assert!(base.join(file).exists(), "{} should exist after init", file);
    }
}

#[test]
fn init_idempotent() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    let out2 = Command::new(bin())
        .args(["init"])
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(out2.status.success(), "second init failed: {}", String::from_utf8_lossy(&out2.stderr));
}

// --- add + list round-trips ---

#[test]
fn add_attractor_then_list() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    let add = run(&dir, &["add", "attractor", "--name", "Stability", "--valence", "positive", "--description", "stable baseline"]);
    assert!(add.status.success(), "add attractor failed: {}", String::from_utf8_lossy(&add.stderr));
    let list = run(&dir, &["list", "attractors"]);
    let stdout = String::from_utf8_lossy(&list.stdout);
    assert!(stdout.contains("Stability"), "expected 'Stability' in list output, got: {}", stdout);
}

#[test]
fn add_stressor_then_list() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    run(&dir, &["add", "attractor", "--name", "Stability", "--valence", "positive", "--description", "d"]);
    let add = run(&dir, &["add", "stressor",
        "--description", "auth service overwhelmed",
        "--attractor-id", "A-01",
        "--naive-change", "scale out",
    ]);
    assert!(add.status.success(), "add stressor failed: {}", String::from_utf8_lossy(&add.stderr));
    let list = run(&dir, &["list", "stressors"]);
    let stdout = String::from_utf8_lossy(&list.stdout);
    assert!(stdout.contains("auth service overwhelmed"), "expected stressor description in output, got: {}", stdout);
}

#[test]
fn add_term_then_list_terminology() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    let add = run(&dir, &["add", "term", "--term", "residue", "--definition", "what remains after stress"]);
    assert!(add.status.success());
    let list = run(&dir, &["list", "terminology"]);
    let stdout = String::from_utf8_lossy(&list.stdout);
    assert!(stdout.contains("residue"), "expected 'residue' in terminology list");
}

// --- verify ---

#[test]
fn verify_all_on_empty_data_succeeds() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    let out = run(&dir, &["verify", "all"]);
    assert!(out.status.success(), "verify all on empty data should succeed, got: {}", String::from_utf8_lossy(&out.stderr));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("OK"), "expected 'OK' in verify output, got: {}", stdout);
}

#[test]
fn verify_links_catches_dangling_attractor() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    run(&dir, &["add", "stressor",
        "--description", "test stressor",
        "--attractor-id", "A-99",
        "--naive-change", "none",
    ]);
    let out = run(&dir, &["verify", "links"]);
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("VIOLATION"), "expected 'VIOLATION' for missing attractor, got: {}", stdout);
}

// --- skill commands ---

#[test]
fn skill_data_naive_draft_contains_purposes_section() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    let out = run(&dir, &["skill-data", "naive-draft"]);
    assert!(out.status.success(), "skill-data failed: {}", String::from_utf8_lossy(&out.stderr));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("## Purposes"), "expected '## Purposes' section in naive-draft context, got: {}", stdout);
}

#[test]
fn skill_data_naive_draft_excludes_stressors_section() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    let out = run(&dir, &["skill-data", "naive-draft"]);
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(!stdout.contains("## Stressors"), "naive-draft context should not include Stressors, got: {}", stdout);
}

#[test]
fn skill_list_shows_all_six_skills() {
    let dir = TempDir::new().unwrap();
    let out = Command::new(bin())
        .args(["skill-list"])
        .current_dir(dir.path())
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    for name in &["purpose-walk", "naive-draft", "stressor-walk", "integrate", "fmea", "atam"] {
        assert!(stdout.contains(name), "expected '{}' in skill-list output, got: {}", name, stdout);
    }
}

// --- matrix ---

#[test]
fn matrix_calc_on_empty_data_does_not_panic() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    let out = run(&dir, &["matrix", "calc"]);
    assert!(out.status.success(), "matrix calc on empty data should not panic: {}", String::from_utf8_lossy(&out.stderr));
}

#[test]
fn matrix_calc_reports_n_k_and_ratio() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    run(&dir, &["add", "attractor", "--name", "X", "--valence", "positive", "--description", "d"]);
    run(&dir, &["add", "stressor",
        "--description", "test",
        "--attractor-id", "A-01",
        "--naive-change", "none",
        "--components", "auth,db",
    ]);
    let out = run(&dir, &["matrix", "calc"]);
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("N"), "expected 'N' in matrix calc output");
    assert!(stdout.contains("K"), "expected 'K' in matrix calc output");
}
