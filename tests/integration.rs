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
    let add = run(&dir, &["add", "attractor", "--name", "Stability", "--description", "stable baseline", "--positive-state", "coherent", "--negative-state", "collapse"]);
    assert!(add.status.success(), "add attractor failed: {}", String::from_utf8_lossy(&add.stderr));
    let list = run(&dir, &["list", "attractors"]);
    let stdout = String::from_utf8_lossy(&list.stdout);
    assert!(stdout.contains("Stability"), "expected 'Stability' in list output, got: {}", stdout);
}

#[test]
fn add_stressor_then_list() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    run(&dir, &["add", "attractor", "--name", "Stability", "--description", "d", "--positive-state", "ok", "--negative-state", "bad"]);
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
fn verify_commit_msg_rejects_conventional_prefix() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    let out = run(&dir, &["verify", "commit-msg", "--message", "fix: broken hook"]);
    assert!(out.status.success(), "warn mode should exit 0, stderr={}", String::from_utf8_lossy(&out.stderr));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("VIOLATION"), "expected violation, got: {stdout}");
}

#[test]
fn verify_commit_msg_accepts_general_prefix() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    let out = run(&dir, &["verify", "commit-msg", "--message", "general - bump deps"]);
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("OK"), "got: {stdout}");
}

#[test]
fn commit_check_accepts_force_subject() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    std::fs::write(
        dir.path().join("residual/components.csv"),
        "name,description,status,architecture_set\nverification-git-hook,hook,proposed,test\n",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("residual/forces.csv"),
        "id,kind,shortname,naive_change,outcomes,description,attractor_id\n\
         S-28,stressor,lexicon-commit-drift,add hook,git hook enforces lexicon,drift,A-02\n",
    )
    .unwrap();
    let out = run(
        &dir,
        &[
            "commit",
            "check",
            "--message",
            "verification-git-hook: S-28: commit-msg validation",
        ],
    );
    assert!(out.status.success(), "stderr={}", String::from_utf8_lossy(&out.stderr));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("OK"), "got: {stdout}");
}

#[test]
fn commit_template_prints_scaffold() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    std::fs::write(
        dir.path().join("residual/forces.csv"),
        "id,kind,shortname,naive_change,outcomes,description,attractor_id\n\
         P-18,purpose,git-log-lexicon,add hook,git log uses lexicon,desc,A-01\n",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("residual/residues.csv"),
        "id,force_id,component_id,status,notes\nR-1,P-18,verification-git-hook,proposed,hook\n",
    )
    .unwrap();
    let out = run(&dir, &["commit", "template", "P-18"]);
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("verification-git-hook: P-18:"), "got: {stdout}");
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
    assert!(!out.status.success(), "verify links should fail on dangling attractor");
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("VIOLATION"), "expected 'VIOLATION' for missing attractor, got: {}", stdout);
}

// --- skill commands ---

#[test]
fn skill_data_naive_draft_contains_purposes_section() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    let out = run(&dir, &["skill", "data", "naive-draft"]);
    assert!(out.status.success(), "skill data failed: {}", String::from_utf8_lossy(&out.stderr));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("## Purposes"), "expected '## Purposes' section in naive-draft context, got: {}", stdout);
}

#[test]
fn skill_data_naive_draft_excludes_stressors_section() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    let out = run(&dir, &["skill", "data", "naive-draft"]);
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(!stdout.contains("## Stressors"), "naive-draft context should not include Stressors, got: {}", stdout);
}

#[test]
fn skill_list_shows_all_skills() {
    let dir = TempDir::new().unwrap();
    let out = Command::new(bin())
        .args(["skill", "list"])
        .current_dir(dir.path())
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    for name in &["purpose-walk", "naive-draft", "stressor-walk", "integrate", "fmea", "atam", "tdd-implement"] {
        assert!(stdout.contains(name), "expected '{}' in skill list output, got: {}", name, stdout);
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
    run(&dir, &["add", "attractor", "--name", "X", "--description", "d", "--positive-state", "ok", "--negative-state", "bad"]);
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

#[test]
fn matrix_show_csv_emits_header_and_cells() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    run(&dir, &["add", "attractor", "--name", "X", "--description", "d", "--positive-state", "ok", "--negative-state", "bad"]);
    run(&dir, &["add", "stressor",
        "--description", "skill versions drift after binary update",
        "--attractor-id", "A-01",
        "--naive-change", "pin skill versions",
        "--components", "auth,db",
        "--outcomes", "skill residue stays current",
    ]);
    // Seed a shortname via forces.csv (add stressor may not write forces yet).
    let forces = dir.path().join("residual/forces.csv");
    std::fs::write(
        &forces,
        "id,kind,shortname,naive_change,outcomes,description,attractor_id\n\
         S-01,stressor,skill-version-drift,pin skill versions,skill residue stays current,skill versions drift after binary update,A-01\n",
    )
    .unwrap();
    let out = run(&dir, &["matrix", "show", "--csv"]);
    assert!(out.status.success(), "stderr={}", String::from_utf8_lossy(&out.stderr));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("skill-version-drift"), "expected shortname row, got:\n{stdout}");
    assert!(stdout.contains("auth") && stdout.contains("db"), "expected component headers, got:\n{stdout}");
    assert!(stdout.contains("total"), "expected total margin, got:\n{stdout}");
    assert!(stdout.contains("── A-01"), "expected attractor separator, got:\n{stdout}");
    assert!(!stdout.contains("┌"), "csv mode must not emit table borders");
}

#[test]
fn matrix_show_filter_keeps_matching_attractor() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    run(&dir, &["add", "attractor", "--name", "One", "--description", "d", "--positive-state", "ok", "--negative-state", "bad"]);
    run(&dir, &["add", "attractor", "--name", "Two", "--description", "d", "--positive-state", "ok", "--negative-state", "bad"]);
    run(&dir, &["add", "stressor",
        "--description", "first force hits auth",
        "--attractor-id", "A-01",
        "--naive-change", "none",
        "--components", "auth",
        "--outcomes", "operator records a stressor against attractor one",
    ]);
    run(&dir, &["add", "stressor",
        "--description", "second force hits db",
        "--attractor-id", "A-02",
        "--naive-change", "none",
        "--components", "db",
        "--outcomes", "operator records a stressor against attractor two",
    ]);
    let forces = dir.path().join("residual/forces.csv");
    std::fs::write(
        &forces,
        "id,kind,shortname,naive_change,outcomes,description,attractor_id\n\
         S-01,stressor,alpha-force,none,operator records a stressor against attractor one,first force hits auth,A-01\n\
         S-02,stressor,beta-force,none,operator records a stressor against attractor two,second force hits db,A-02\n",
    )
    .unwrap();
    let out = run(&dir, &["matrix", "show", "--csv", "--filter", "A-02"]);
    assert!(out.status.success(), "stderr={}", String::from_utf8_lossy(&out.stderr));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("beta-force"), "got:\n{stdout}");
    assert!(!stdout.contains("alpha-force"), "filter should drop A-01, got:\n{stdout}");
    assert!(stdout.contains("── A-02"), "got:\n{stdout}");
}

#[test]
fn matrix_show_sort_by_alphabetical() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    run(&dir, &["add", "attractor", "--name", "X", "--description", "d", "--positive-state", "ok", "--negative-state", "bad"]);
    run(&dir, &["add", "stressor",
        "--description", "zeta force",
        "--attractor-id", "A-01",
        "--naive-change", "none",
        "--components", "auth",
        "--outcomes", "operator records residue zeta",
    ]);
    run(&dir, &["add", "stressor",
        "--description", "alpha force",
        "--attractor-id", "A-01",
        "--naive-change", "none",
        "--components", "db",
        "--outcomes", "operator records residue alpha",
    ]);
    let forces = dir.path().join("residual/forces.csv");
    std::fs::write(
        &forces,
        "id,kind,shortname,naive_change,outcomes,description,attractor_id\n\
         S-01,stressor,zeta-force,none,operator records residue zeta,zeta force,A-01\n\
         S-02,stressor,alpha-force,none,operator records residue alpha,alpha force,A-01\n",
    )
    .unwrap();
    let out = run(&dir, &["matrix", "show", "--csv", "--sort-by", "alphabetical"]);
    assert!(out.status.success(), "stderr={}", String::from_utf8_lossy(&out.stderr));
    let stdout = String::from_utf8_lossy(&out.stdout);
    let alpha = stdout.find("alpha-force").expect("alpha");
    let zeta = stdout.find("zeta-force").expect("zeta");
    assert!(alpha < zeta, "alphabetical order failed:\n{stdout}");
}

// --- A-04 Data Fragmentation ---

#[test]
fn init_preserves_existing_attractors_on_partial_tree() {
    let dir = TempDir::new().unwrap();
    let base = dir.path().join("residual");
    std::fs::create_dir_all(&base).unwrap();
    std::fs::write(
        base.join("attractors.csv"),
        "id,name,description,positive_state,negative_state\nA-99,Kept,existing link,positive ok,negative bad\n",
    )
    .unwrap();
    init(&dir);
    assert!(std::fs::read_to_string(base.join("attractors.csv")).unwrap().contains("A-99"));
}

#[test]
fn stressor_append_rewrite_preserves_all_rows() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    run(&dir, &["add", "attractor", "--name", "X", "--description", "d", "--positive-state", "ok", "--negative-state", "bad"]);
    run(&dir, &["add", "stressor", "--description", "first", "--attractor-id", "A-01", "--naive-change", "cache"]);
    run(&dir, &["add", "stressor", "--description", "second", "--attractor-id", "A-01", "--naive-change", "lock"]);
    let content = std::fs::read_to_string(dir.path().join("residual/stressors.csv")).unwrap();
    assert_eq!(content.matches("id,").count(), 1);
    assert!(content.contains("first"));
    assert!(content.contains("second"));
}

#[test]
fn residues_csv_is_matrix_shaped_after_write() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    run(&dir, &["add", "attractor", "--name", "X", "--description", "d", "--positive-state", "ok", "--negative-state", "bad"]);
    run(&dir, &["add", "stressor", "--description", "lag", "--attractor-id", "A-01", "--naive-change", "cache"]);
    std::fs::write(
        dir.path().join("residual/forces.csv"),
        "id,kind,shortname,naive_change,outcomes,description,attractor_id\nS-01,stressor,lexicon-scale-lag,cache,operator validates traits,lag,A-01\n",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("residual/components.csv"),
        "name,description,status,architecture_set\nverification,path,proposed,baseline\n",
    )
    .unwrap();
    assert!(
        run(&dir, &["add", "--force", "residue", "--force-id", "S-01", "--component-id", "verification", "--status", "proposed"]).status.success()
    );
    assert!(std::fs::read_to_string(dir.path().join("residual/residues.csv")).unwrap().starts_with("force,"));
}

#[test]
fn verify_links_accepts_purpose_residue() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    run(&dir, &["add", "attractor", "--name", "L", "--description", "d", "--positive-state", "ok", "--negative-state", "bad"]);
    run(&dir, &["add", "purpose", "--description", "d", "--attractor-id", "A-01", "--feature", "f", "--outcomes", "operator reads commit history using defined outcome", "--shortname", "git-log-lexicon"]);
    std::fs::write(
        dir.path().join("residual/components.csv"),
        "name,description,status,architecture_set\nhook,desc,proposed,baseline\n",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("residual/forces.csv"),
        "id,kind,shortname,naive_change,outcomes,description,attractor_id\nP-01,purpose,git-log-lexicon,h,operator reads commit history using defined outcome,purpose force,A-01\n",
    )
    .unwrap();
    assert!(
        run(&dir, &["add", "--force", "residue", "--force-id", "P-01", "--component-id", "hook", "--status", "proposed"]).status.success()
    );
    assert!(run(&dir, &["verify", "links"]).status.success());
}

// --- shortname CLI tests (RED: --shortname arg not yet accepted by add stressor/purpose) ---

#[test]
fn add_stressor_cli_stores_shortname() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    let add_attr = run(
        &dir,
        &[
            "add", "attractor",
            "--name", "Stability",
            "--description", "stable",
            "--positive-state", "coherent",
            "--negative-state", "collapse",
        ],
    );
    assert!(add_attr.status.success(), "add attractor failed: {}", String::from_utf8_lossy(&add_attr.stderr));
    let add = run(
        &dir,
        &[
            "add", "stressor",
            "--description", "test stressor",
            "--attractor-id", "A-01",
            "--naive-change", "fix it",
            "--outcomes", "operator records stressor",
            "--shortname", "cli-bypass",
        ],
    );
    assert!(add.status.success(), "add stressor with --shortname failed: {}", String::from_utf8_lossy(&add.stderr));
    let content = std::fs::read_to_string(dir.path().join("residual/stressors.csv")).unwrap();
    assert!(
        content.contains("cli-bypass"),
        "expected 'cli-bypass' in stressors.csv, got:\n{content}"
    );
}

#[test]
fn add_purpose_cli_stores_shortname() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    let add_attr = run(
        &dir,
        &[
            "add", "attractor",
            "--name", "Stability",
            "--description", "stable",
            "--positive-state", "coherent",
            "--negative-state", "collapse",
        ],
    );
    assert!(add_attr.status.success(), "add attractor failed: {}", String::from_utf8_lossy(&add_attr.stderr));
    let add = run(
        &dir,
        &[
            "add", "purpose",
            "--description", "test purpose",
            "--attractor-id", "A-01",
            "--feature", "add purpose CLI",
            "--outcomes", "operator adds purposes",
            "--shortname", "persona-subagent-depth",
        ],
    );
    assert!(add.status.success(), "add purpose with --shortname failed: {}", String::from_utf8_lossy(&add.stderr));
    let content = std::fs::read_to_string(dir.path().join("residual/purposes.csv")).unwrap();
    assert!(
        content.contains("persona-subagent-depth"),
        "expected 'persona-subagent-depth' in purposes.csv, got:\n{content}"
    );
}

#[test]
fn list_stressors_shows_shortname() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    run(
        &dir,
        &[
            "add", "attractor",
            "--name", "Stability",
            "--description", "stable",
            "--positive-state", "coherent",
            "--negative-state", "collapse",
        ],
    );
    run(
        &dir,
        &[
            "add", "stressor",
            "--description", "test stressor",
            "--attractor-id", "A-01",
            "--naive-change", "fix it",
            "--outcomes", "operator records stressor",
            "--shortname", "cli-bypass",
        ],
    );
    let list = run(&dir, &["list", "stressors"]);
    let stdout = String::from_utf8_lossy(&list.stdout);
    assert!(
        stdout.contains("cli-bypass"),
        "expected 'cli-bypass' in list stressors output, got:\n{stdout}"
    );
}

#[test]
fn list_purposes_shows_shortname() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    run(
        &dir,
        &[
            "add", "attractor",
            "--name", "Stability",
            "--description", "stable",
            "--positive-state", "coherent",
            "--negative-state", "collapse",
        ],
    );
    run(
        &dir,
        &[
            "add", "purpose",
            "--description", "test purpose",
            "--attractor-id", "A-01",
            "--feature", "add purpose CLI",
            "--outcomes", "operator adds purposes",
            "--shortname", "persona-subagent-depth",
        ],
    );
    let list = run(&dir, &["list", "purposes"]);
    let stdout = String::from_utf8_lossy(&list.stdout);
    assert!(
        stdout.contains("persona-subagent-depth"),
        "expected 'persona-subagent-depth' in list purposes output, got:\n{stdout}"
    );
}

#[test]
fn list_residues_prints_matrix() {
    let dir = TempDir::new().unwrap();
    init(&dir);
    run(&dir, &["add", "attractor", "--name", "X", "--description", "d", "--positive-state", "ok", "--negative-state", "bad"]);
    std::fs::write(
        dir.path().join("residual/forces.csv"),
        "id,kind,shortname,naive_change,outcomes,description,attractor_id\nS-01,stressor,t,c,o,d,A-01\n",
    )
    .unwrap();
    std::fs::write(
        dir.path().join("residual/components.csv"),
        "name,description,status,architecture_set\ncli,desc,proposed,baseline\n",
    )
    .unwrap();
    run(&dir, &["add", "--force", "residue", "--force-id", "S-01", "--component-id", "cli", "--status", "active"]);
    let list = run(&dir, &["list", "residues"]);
    assert!(list.status.success());
    assert!(String::from_utf8_lossy(&list.stdout).starts_with("force,"));
}
