/// Ensures fish completions never reference commands that don't exist and never
/// silently drop a subcommand when the CLI gains or renames one.
///
/// Failure modes caught:
/// - Ghost top-level: `skill-install` listed as top-level after rename to `skill install`
/// - Missing subcommand: `residue` absent from `add` completions after it was added
/// - Ghost subcommand: `skill-check` listed under `skill` after rename to `check-install`
use std::collections::{HashMap, HashSet};
use std::process::Command;

fn bin() -> std::path::PathBuf {
    env!("CARGO_BIN_EXE_residual").into()
}

fn completions_output() -> String {
    let out = Command::new(bin())
        .args(["generate", "completions"])
        .output()
        .expect("residual generate completions");
    String::from_utf8(out.stdout).unwrap()
}

/// Extract space-separated values from `-a 'foo bar'` in a completion line.
fn extract_a_values(line: &str) -> Option<Vec<String>> {
    let pos = line.find(" -a '")?;
    let rest = &line[pos + 5..];
    let end = rest.find('\'')?;
    Some(
        rest[..end]
            .split_whitespace()
            .map(|s| s.to_string())
            .collect(),
    )
}

/// All `-a` tokens from `__fish_use_subcommand` lines — the proposed top-level commands.
fn completion_top_level(completions: &str) -> HashSet<String> {
    let mut out = HashSet::new();
    for line in completions.lines() {
        if line.contains("__fish_use_subcommand") {
            if let Some(vals) = extract_a_values(line) {
                out.extend(vals);
            }
        }
    }
    out
}

/// Per-parent `-a` tokens from `__fish_seen_subcommand_from PARENT` lines,
/// excluding lines that define `--long` flag completions (`-l`).
fn completion_subcommands(completions: &str) -> HashMap<String, HashSet<String>> {
    let mut map: HashMap<String, HashSet<String>> = HashMap::new();
    for line in completions.lines() {
        if !line.contains("__fish_seen_subcommand_from ") {
            continue;
        }
        // Skip long-flag completions (they don't name subcommands)
        if line.contains(" -l ") {
            continue;
        }
        let Some(vals) = extract_a_values(line) else {
            continue;
        };
        let Some(from_pos) = line.find("__fish_seen_subcommand_from ") else {
            continue;
        };
        let after = &line[from_pos + "__fish_seen_subcommand_from ".len()..];
        let parent: String = after.trim_start_matches('\'').split('\'').next().unwrap_or("").into();
        if parent.is_empty() {
            continue;
        }
        map.entry(parent).or_default().extend(vals);
    }
    map
}

/// Subcommand names from `residual [args…] --help`, excluding `help` itself.
fn cli_subcommands(args: &[&str]) -> HashSet<String> {
    let mut all_args: Vec<&str> = args.to_vec();
    all_args.push("--help");
    let out = Command::new(bin())
        .args(&all_args)
        .output()
        .expect("residual --help");
    let text = String::from_utf8(out.stdout).unwrap();
    let mut in_cmds = false;
    let mut result = HashSet::new();
    for line in text.lines() {
        if line.trim_end() == "Commands:" {
            in_cmds = true;
            continue;
        }
        if !in_cmds {
            continue;
        }
        if line.starts_with("Options:") || line.starts_with("Arguments:") {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(name) = trimmed.split_whitespace().next() {
            if name != "help" {
                result.insert(name.to_string());
            }
        }
    }
    result
}

/// Skill names from `residual skill list` — data lines come after the `---` separator.
fn skill_names() -> HashSet<String> {
    let out = Command::new(bin())
        .args(["skill", "list"])
        .output()
        .expect("residual skill list");
    let text = String::from_utf8(out.stdout).unwrap();
    let mut past_separator = false;
    let mut names = HashSet::new();
    for line in text.lines() {
        if line.starts_with("---") {
            past_separator = true;
            continue;
        }
        if past_separator {
            if let Some(name) = line.split_whitespace().next() {
                names.insert(name.to_string());
            }
        }
    }
    names
}

// --- tests ---

#[test]
fn no_ghost_top_level_commands() {
    let completions = completions_output();
    let proposed = completion_top_level(&completions);
    let actual = cli_subcommands(&[]);
    let ghost: Vec<_> = proposed.difference(&actual).collect();
    assert!(
        ghost.is_empty(),
        "completions list top-level commands that don't exist: {ghost:?}\nActual: {actual:?}"
    );
}

#[test]
fn all_subcommands_covered_for_each_parent() {
    let completions = completions_output();
    let comp_map = completion_subcommands(&completions);

    // Parents that have explicit completion entries — we commit to full coverage for these.
    for (parent, comp_tokens) in &comp_map {
        let actual = cli_subcommands(&[parent.as_str()]);
        if actual.is_empty() {
            continue; // parent is a leaf command
        }
        let missing: Vec<_> = actual.difference(comp_tokens).collect();
        assert!(
            missing.is_empty(),
            "`residual {parent}` subcommands missing from completions: {missing:?}\nCompletion tokens: {comp_tokens:?}"
        );
    }
}

#[test]
fn no_ghost_subcommands_outside_skill() {
    let completions = completions_output();
    let comp_map = completion_subcommands(&completions);

    for (parent, comp_tokens) in &comp_map {
        if parent == "skill" {
            continue; // skill also contains skill-name arguments; handled separately
        }
        let actual = cli_subcommands(&[parent.as_str()]);
        let ghost: Vec<_> = comp_tokens.difference(&actual).collect();
        assert!(
            ghost.is_empty(),
            "completions for `residual {parent}` list tokens that aren't subcommands: {ghost:?}\nActual: {actual:?}"
        );
    }
}

#[test]
fn skill_completion_tokens_are_subcommands_or_skill_names() {
    let completions = completions_output();
    let comp_map = completion_subcommands(&completions);
    let Some(skill_tokens) = comp_map.get("skill") else {
        panic!("no completions found for `skill` parent");
    };
    let actual_subcommands = cli_subcommands(&["skill"]);
    let valid_skill_names = skill_names();

    let ghost: Vec<_> = skill_tokens
        .iter()
        .filter(|t| !actual_subcommands.contains(*t) && !valid_skill_names.contains(*t))
        .collect();
    assert!(
        ghost.is_empty(),
        "skill completions contain tokens that are neither a subcommand nor a skill name: {ghost:?}\nSubcommands: {actual_subcommands:?}\nSkill names: {valid_skill_names:?}"
    );
}
