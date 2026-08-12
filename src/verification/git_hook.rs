//! Git hook install — pre-commit runs verification; commit-msg validates vocabulary.

use anyhow::{Context, Result};

pub fn install() -> Result<()> {
    let git_hooks_dir = find_git_hooks_dir()?;

    let pre_commit = git_hooks_dir.join("pre-commit");
    let pre_commit_content = r#"#!/usr/bin/env bash
# residual pre-commit hook — validates residual/ data before commit
STAGED=$(git diff --cached --name-only | grep '^residual/')

if [ -z "$STAGED" ]; then
  STRICT=$(residual config 2>/dev/null | grep 'strict' | awk '{print $3}')
  [ "$STRICT" = "false" ] && exit 0
fi

residual verify all || exit 1
"#;

    let commit_msg = git_hooks_dir.join("commit-msg");
    let commit_msg_content = r#"#!/usr/bin/env bash
# residual commit-msg hook — lexicon/component vocabulary (warn by default)
residual verify commit-msg "$1" --staged || exit 1
"#;

    write_executable_hook(&pre_commit, pre_commit_content)?;
    write_executable_hook(&commit_msg, commit_msg_content)?;

    println!("Installed pre-commit hook to {}", pre_commit.display());
    println!("Installed commit-msg hook to {} (warn by default; set commit_msg_enforce = true in residual/config.toml to block)", commit_msg.display());
    Ok(())
}

fn find_git_hooks_dir() -> Result<std::path::PathBuf> {
    let cwd = std::env::current_dir().context("failed to get current directory")?;
    let mut dir = cwd.as_path();
    loop {
        let candidate = dir.join(".git/hooks");
        if candidate.is_dir() {
            return Ok(candidate);
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => anyhow::bail!("could not find .git/hooks directory (not a git repository?)"),
        }
    }
}

fn write_executable_hook(path: &std::path::Path, content: &str) -> Result<()> {
    std::fs::write(path, content)
        .with_context(|| format!("failed to write hook to {}", path.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(path)?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(path, perms)
            .with_context(|| format!("failed to set permissions on {}", path.display()))?;
    }

    Ok(())
}
