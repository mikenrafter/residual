//! A-07 Software-Only Tunnel Vision — S-23 outcome contract tests.

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

#[test]
fn whole_system_stressor_records_residue() {
    let dir = TempDir::new().unwrap();
    assert!(run(&dir, &["init"]).status.success());
    run(&dir, &["add", "attractor", "--name", "X", "--description", "d", "--positive-state", "ok", "--negative-state", "bad"]);
    let add = run(
        &dir,
        &[
            "add", "stressor",
            "--description", "queue overload",
            "--attractor-id", "A-01",
            "--naive-change", "add retry",
            "--whole-system",
            "--notes", "policy zig: cap tickets",
        ],
    );
    assert!(add.status.success(), "{}", String::from_utf8_lossy(&add.stderr));
    let residues = std::fs::read_to_string(dir.path().join("residual/residues.csv")).unwrap();
    assert!(residues.contains("whole-system-residue"));
}

#[test]
fn skills_and_skill_data_remind_whole_system() {
    let dir = TempDir::new().unwrap();
    assert!(run(&dir, &["init"]).status.success());
    for skill in ["stressor-walk", "fmea", "integrate"] {
        let show = String::from_utf8_lossy(&run(&dir, &["skill-show", skill]).stdout).to_lowercase();
        assert!(show.contains("whole-system"), "{skill} skill-show");
        let out = run(&dir, &["skill-data", skill]);
        let data = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)).to_lowercase();
        assert!(data.contains("whole-system"), "{skill} skill-data");
    }
}

#[test]
fn software_only_stressor_add_prints_reminder() {
    let dir = TempDir::new().unwrap();
    assert!(run(&dir, &["init"]).status.success());
    run(&dir, &["add", "attractor", "--name", "X", "--description", "d", "--positive-state", "ok", "--negative-state", "bad"]);
    let add = run(
        &dir,
        &["add", "stressor", "--description", "load", "--attractor-id", "A-01", "--naive-change", "cache"],
    );
    assert!(add.status.success());
    let out = format!("{}{}", String::from_utf8_lossy(&add.stdout), String::from_utf8_lossy(&add.stderr)).to_lowercase();
    assert!(out.contains("whole-system"));
}
