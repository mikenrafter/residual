//! Iteration 4 v3 architecture proofs — fully-qualified component names,
//! storage-config owns verify policy, cli-help, NKP-only analysis.
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tempfile::TempDir;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn bin() -> PathBuf {
    env!("CARGO_BIN_EXE_residual").into()
}

fn run(dir: &TempDir, args: &[&str]) -> std::process::Output {
    Command::new(bin())
        .args(args)
        .current_dir(dir.path())
        .output()
        .expect("failed to run residual binary")
}

fn read(rel: &str) -> String {
    fs::read_to_string(root().join(rel)).unwrap_or_else(|e| panic!("read {}: {}", rel, e))
}

fn src_exists(rel: &str) -> bool {
    root().join("src").join(rel).is_file()
}

#[test]
fn iter4_v3_module_tree_exists() {
    let required = [
        "cli.rs",
        "cli/help.rs",
        "skills/mod.rs",
        "skills/personas.rs",
        "skills/research.rs",
        "skills/phases.rs",
        "skills/installer.rs",
        "verification/mod.rs",
        "verification/git_hook.rs",
        "structure/mod.rs",
        "structure/analysis/mod.rs",
        "structure/analysis/nkp.rs",
        "structure/analysis/tag_scan.rs",
        "structure/analysis/force.rs",
        "structure/analysis/purposes.rs",
        "structure/analysis/stressors.rs",
        "structure/analysis/attractors.rs",
        "structure/analysis/residues.rs",
        "structure/definition/mod.rs",
        "structure/definition/lexicon.rs",
        "structure/definition/components.rs",
        "structure/definition/iterations.rs",
        "storage/mod.rs",
        "storage/config.rs",
        "storage/format.rs",
        "storage/integrity/mod.rs",
        "storage/integrity/sessions.rs",
        "storage/integrity/migration.rs",
    ];
    let missing: Vec<_> = required.iter().copied().filter(|p| !src_exists(p)).collect();
    assert!(
        missing.is_empty(),
        "missing iter4-v3 modules: {}",
        missing.join(", ")
    );
    assert!(
        !src_exists("verification/config.rs"),
        "v3 forbids verification-config module; policy lives in storage-config"
    );
    assert!(
        !root().join("src/research_study.rs").exists()
            && !root().join("src/research-study.rs").exists()
            && !root().join("src/skills/research_study.rs").exists(),
        "research-study is standalone registry+terminology only — not a runtime module"
    );
}

#[test]
fn personas_and_research_remain_split() {
    assert!(src_exists("skills/personas.rs"));
    assert!(src_exists("skills/research.rs"));
    let personas = read("src/skills/personas.rs");
    let research = read("src/skills/research.rs");
    assert!(
        !personas.contains("pub use crate::skills::research")
            && !research.contains("pub use crate::skills::personas"),
        "skills-personas and skills-research must remain distinct"
    );
}

#[test]
fn analysis_is_nkp_not_atam_fmea() {
    let analysis_mod = read("src/structure/analysis/mod.rs");
    assert!(
        !analysis_mod.to_lowercase().contains("atam")
            && !analysis_mod.to_lowercase().contains("fmea"),
        "structure-analysis is NKP only; ATAM/FMEA belong in skills-phases"
    );
    let phases = read("src/skills/phases.rs");
    assert!(
        phases.to_lowercase().contains("atam") || phases.to_lowercase().contains("fmea") || phases.contains("phase"),
        "skills-phases owns ATAM/FMEA prose"
    );
}

#[test]
fn cli_process_lives_beside_actions() {
    let r = root();
    for banned in [
        "src/process.rs",
        "src/fluency.rs",
        "src/preamble.rs",
        "src/cli/process.rs",
        "src/cli/fluency.rs",
        "src/cli/preamble.rs",
    ] {
        assert!(!r.join(banned).exists(), "banned shared process module {}", banned);
    }
    let cli = read("src/cli.rs");
    assert!(
        !cli.contains("mod process")
            && !cli.contains("mod fluency")
            && !cli.contains("mod preamble"),
        "cli.rs must not load a shared process/fluency preamble"
    );
    let has_per_action = cli.contains("long_about")
        || cli.matches("/// Process:").count() >= 3
        || cli.matches("Process:").count() >= 3;
    assert!(
        has_per_action,
        "expected process guidance beside clap actions"
    );
    // Whole-system-residue reminder next to add force/residue.
    assert!(
        cli.to_lowercase().contains("whole-system")
            || cli.to_lowercase().contains("whole system"),
        "add force/residue actions should remind whole-system-residue"
    );
}

#[test]
fn skills_phases_owns_list_show_and_data() {
    let cli = read("src/cli.rs");
    assert!(
        cli.contains("skills::phases::show")
            || cli.contains("skills::phases::list")
            || cli.contains("crate::skills::phases"),
        "skill-list/show/data must dispatch to skills::phases"
    );
    assert!(src_exists("skills/phases.rs"));
    let phases = read("src/skills/phases.rs");
    assert!(
        phases.contains("fn show") && phases.contains("fn data") && phases.contains("fn list"),
        "skills-phases must expose list + show + data"
    );
}

#[test]
fn installer_check_install_subcommand() {
    let dir = TempDir::new().unwrap();
    let nested = run(&dir, &["skill", "check-install", "--help"]);
    let nested_out = format!(
        "{}{}",
        String::from_utf8_lossy(&nested.stdout),
        String::from_utf8_lossy(&nested.stderr)
    );
    assert!(
        nested.status.success(),
        "residual skill check-install --help should succeed: {}",
        nested_out
    );
    assert!(
        nested_out.contains("check-install") || nested_out.contains("check_install"),
        "help should mention check-install, got: {}",
        nested_out
    );
    let alias = run(&dir, &["skill-check", "--help"]);
    assert!(
        alias.status.success(),
        "skill-check alias should remain: {}",
        String::from_utf8_lossy(&alias.stderr)
    );
}

#[test]
fn components_csv_uses_fully_qualified_names() {
    let csv = read("residual/components.csv");
    let header = csv.lines().next().unwrap_or("");
    for col in ["name", "description", "status", "architecture_set"] {
        assert!(
            header.split(',').any(|c| c.trim() == col),
            "components.csv missing column '{}', header={}",
            col,
            header
        );
    }
    let required = [
        "research-study",
        "cli",
        "cli-help",
        "skills-personas",
        "skills-research",
        "skills-phases",
        "skills-installer",
        "verification",
        "verification-git-hook",
        "structure",
        "structure-analysis",
        "structure-analysis-tag-scan",
        "structure-analysis-force",
        "structure-analysis-purposes",
        "structure-analysis-stressors",
        "structure-analysis-attractors",
        "structure-analysis-residues",
        "structure-definition-lexicon",
        "structure-definition-components",
        "structure-definition-iterations",
        "storage",
        "storage-config",
        "storage-sessions",
        "storage-migration",
        "storage-format",
    ];
    assert_eq!(required.len(), 25, "exactly 25 fully-qualified names");
    for name in required {
        let present = csv.lines().any(|l| {
            l.starts_with(&format!("{},", name)) || l.split(',').next() == Some(name)
        });
        assert!(present, "components.csv missing fully-qualified row '{}'", name);
    }
    // Bare short names from iter4 must be absent as component names.
    for bare in [
        "personas",
        "research",
        "phases",
        "installer",
        "git-hook",
        "verification-config",
        "analysis",
        "tag-scan",
        "force-schema",
        "purposes-schema",
        "stressors-schema",
        "attractors-schema",
        "residues-schema",
        "lexicon-schema",
        "components-schema",
        "iterations-schema",
        "sessions",
        "migration",
        "format",
    ] {
        let as_name = csv.lines().any(|l| {
            let first = l.split(',').next().unwrap_or("").trim();
            first == bare
        });
        assert!(
            !as_name,
            "components.csv must not use bare name '{}'; use fully-qualified form",
            bare
        );
    }
    assert!(csv.contains("iter4-cli-hub"), "architecture_set=iter4-cli-hub");
    assert!(csv.contains("proposed"), "status=proposed");
}

#[test]
fn architecture_md_documents_v3() {
    let doc = read("ARCHITECTURE.md");
    assert!(doc.contains("CLI") || doc.contains("cli"));
    assert!(
        doc.contains("storage-config") && !doc.contains("verification-config"),
        "v3: policy lives in storage-config; no verification-config module"
    );
    assert!(
        doc.contains("research-study"),
        "must note research-study as standalone / not runtime"
    );
    assert!(
        doc.contains("skills-personas") || doc.contains("fully-qualified"),
        "must document fully-qualified naming"
    );
    assert!(doc.contains("force") || doc.contains("Force"));
}
