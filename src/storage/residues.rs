use anyhow::{bail, Result};
use std::path::Path;

use crate::structure::analysis::residues::Residue;
use crate::storage::format::{read_residues, write_residues};
use crate::storage::{purposes, stressors};

pub fn load(residual_dir: &Path) -> Result<Vec<Residue>> {
    read_residues(residual_dir)
}

pub fn next_id(existing: &[Residue]) -> String {
    let max = existing
        .iter()
        .filter_map(|r| r.id.strip_prefix('R'))
        .filter_map(|s| s.parse::<u32>().ok())
        .max()
        .unwrap_or(0);
    format!("R-{:02}", max + 1)
}

pub fn force_exists(residual_dir: &Path, force_id: &str) -> Result<bool> {
    if stressors::load(residual_dir)?
        .iter()
        .any(|s| s.id == force_id)
    {
        return Ok(true);
    }
    if purposes::load(residual_dir)?
        .iter()
        .any(|p| p.id == force_id)
    {
        return Ok(true);
    }
    Ok(crate::storage::format::read_forces(residual_dir)?
        .iter()
        .any(|f| f.id == force_id))
}

pub fn append(residual_dir: &Path, residue: Residue) -> Result<()> {
    let mut rows = load(residual_dir)?;
    if rows.iter().any(|r| r.id == residue.id) {
        bail!("residue id '{}' already exists", residue.id);
    }
    rows.push(residue);
    write_residues(residual_dir, &rows)
}

pub fn append_whole_system(
    residual_dir: &Path,
    force_id: &str,
    notes: &str,
) -> Result<String> {
    if notes.trim().is_empty() {
        bail!("--whole-system requires --notes describing the hardware, process, organization, or policy zig");
    }
    if !force_exists(residual_dir, force_id)? {
        bail!("force id '{}' not found in stressors, purposes, or forces", force_id);
    }
    let existing = load(residual_dir)?;
    let id = next_id(&existing);
    append(residual_dir, Residue::whole_system(id.clone(), force_id, notes))?;
    Ok(id)
}
