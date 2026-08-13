//! Residue persistence — matrix-shaped residues.csv with append ergonomics.

use anyhow::Result;
use std::path::Path;

use crate::structure::analysis::residues::Residue;

pub fn load(residual_dir: &Path) -> Result<Vec<Residue>> {
    crate::storage::format::read_residues(residual_dir)
}

pub fn append(residual_dir: &Path, residue: Residue) -> Result<()> {
    let mut all = load(residual_dir)?;
    if let Some(existing) = all
        .iter_mut()
        .find(|r| r.force_id == residue.force_id && r.component_id == residue.component_id)
    {
        existing.status = residue.status;
        existing.notes = residue.notes;
    } else {
        all.push(residue);
    }
    crate::storage::format::write_residues(residual_dir, &all)
}

pub fn next_id(residues: &[Residue]) -> String {
    let max = residues
        .iter()
        .filter_map(|r| r.id.strip_prefix("R-").and_then(|n| n.parse::<u32>().ok()))
        .max()
        .unwrap_or(0);
    format!("R-{max:02}")
}

pub fn force_exists(residual_dir: &Path, force_id: &str) -> Result<bool> {
    if crate::storage::format::read_forces(residual_dir)?
        .iter()
        .any(|f| f.id == force_id)
    {
        return Ok(true);
    }
    if crate::storage::stressors::load(residual_dir)?
        .iter()
        .any(|s| s.id == force_id)
    {
        return Ok(true);
    }
    if crate::storage::purposes::load(residual_dir)?
        .iter()
        .any(|p| p.id == force_id)
    {
        return Ok(true);
    }
    Ok(false)
}
