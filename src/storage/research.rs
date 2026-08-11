// @residue: R-01
use anyhow::{Context, Result};
use std::path::Path;

pub fn save(residual_dir: &Path, source: &str, content: &str) -> Result<()> {
    let dir = residual_dir.join("research");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}.md", source));
    std::fs::write(&path, content).with_context(|| format!("write {}", path.display()))
}
