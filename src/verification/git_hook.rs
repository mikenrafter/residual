//! Git hook install — pre-commit runs verification.

use anyhow::{Context, Result};

pub fn install() -> Result<()> {
    let cwd = std::env::current_dir().context("failed to get current directory")?;
    let mut dir = cwd.as_path();
    let git_hooks_dir = loop {
        let candidate = dir.join(".git/hooks");
        if candidate.is_dir() {
            break candidate;
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => anyhow::bail!("could not find .git/hooks directory (not a git repository?)"),
        }
    };

    let hook_path = git_hooks_dir.join("pre-commit");
    let hook_content = r#"#!/usr/bin/env bash
# residual pre-commit hook — validates residual/ data before commit
STAGED=$(git diff --cached --name-only | grep '^residual/')

if [ -z "$STAGED" ]; then
  STRICT=$(residual config 2>/dev/null | grep 'strict' | awk '{print $3}')
  [ "$STRICT" = "false" ] && exit 0
fi

residual verify all || exit 1
"#;

    std::fs::write(&hook_path, hook_content)
        .with_context(|| format!("failed to write hook to {}", hook_path.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&hook_path)?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&hook_path, perms)
            .with_context(|| format!("failed to set permissions on {}", hook_path.display()))?;
    }

    println!("Installed pre-commit hook to {}", hook_path.display());
    Ok(())
}
