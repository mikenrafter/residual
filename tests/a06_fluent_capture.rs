use std::process::Command;
use tempfile::TempDir;
fn bin() -> std::path::PathBuf { env!("CARGO_BIN_EXE_residual").into() }
fn run(dir: &TempDir, args: &[&str]) -> std::process::Output { Command::new(bin()).args(args).current_dir(dir.path()).output().unwrap() }
fn init(dir: &TempDir) { assert!(run(dir, &["init"]).status.success()); }

#[test] fn skill_data_stressor_walk_succeeds_without_personas() { let d=TempDir::new().unwrap(); init(&d); assert!(run(&d,&["skill","data","stressor-walk"]).status.success()); }
#[test] fn skill_list_marks_skills_as_selectable_steps() { let s=String::from_utf8_lossy(&run(&TempDir::new().unwrap(),&["skill","list"]).stdout).to_lowercase(); assert!(s.contains("selectable")||s.contains("a-la-carte")||s.contains("lens")); }
#[test] fn skill_show_purpose_walk_describes_analytical_lens() { let s=String::from_utf8_lossy(&run(&TempDir::new().unwrap(),&["skill","show","purpose-walk"]).stdout).to_lowercase(); assert!(s.contains("a-la-carte")||s.contains("analytical lens")||s.contains("optional")); }
#[test] fn verify_all_passes_without_running_any_skill() { let d=TempDir::new().unwrap(); init(&d); run(&d,&["add","attractor","--name","X","--description","d","--positive-state","ok","--negative-state","bad"]); run(&d,&["add","term","--term","operator","--definition","human"]); run(&d,&["add","stressor","--description","p","--attractor-id","A-01","--naive-change","none","--outcomes","operator records stressor mid-session"]); assert!(run(&d,&["verify","all"]).status.success()); }
#[test] fn skill_data_includes_fluent_capture_preamble() { let d=TempDir::new().unwrap(); init(&d); let s=String::from_utf8_lossy(&run(&d,&["skill","data","integrate"]).stdout).to_lowercase(); assert!(s.contains("fluent")||s.contains("any phase")); }
#[test] fn add_purpose_accepts_naive_change_alias_for_feature() { let d=TempDir::new().unwrap(); init(&d); run(&d,&["add","attractor","--name","X","--description","d","--positive-state","ok","--negative-state","bad"]); assert!(run(&d,&["add","purpose","--description","o","--attractor-id","A-01","--naive-change","naive change text"]).status.success()); }
#[test] fn purpose_walk_skill_uses_outcome_not_trait_terminology() { let s=String::from_utf8_lossy(&run(&TempDir::new().unwrap(),&["skill","show","purpose-walk"]).stdout).to_lowercase(); assert!(s.contains("outcome")&&!s.contains(" trait")&&!s.contains("traits")); }
#[test] fn generate_man_leads_with_fluent_entry_model() { let s=String::from_utf8_lossy(&run(&TempDir::new().unwrap(),&["generate","man"]).stdout).to_lowercase(); let dp=s.find(".sh description").unwrap_or(0); assert!(s.find("fluent").or_else(||s.find("a-la-carte")).is_some_and(|p|p<=dp+800)); }
