//! Residue persistence — matrix-shaped residues.csv with append ergonomics.

use anyhow::{bail, Result};
use std::path::Path;

use crate::structure::analysis::residues::Residue;

pub fn load(residual_dir: &Path) -> Result<Vec<Residue>> {
    crate::storage::format::read_residues(residual_dir)
}

/// Upsert by (force_id, component_id); keeps matrix writes idempotent (A-04).
pub fn append(residual_dir: &Path, residue: Residue) -> Result<()> {
    let mut all = load(residual_dir)?;
    if let Some(existing) = all
        .iter_mut()
        .find(|r| r.force_id == residue.force_id && r.component_id == residue.component_id)
    {
        existing.status = residue.status;
        existing.notes = residue.notes;
        if existing.id.is_empty() {
            existing.id = residue.id;
        }
    } else {
        all.push(residue);
    }
    crate::storage::format::write_residues(residual_dir, &all)
}

pub fn next_id(residues: &[Residue]) -> String {
    let max = residues
        .iter()
        .filter_map(|r| {
            r.id.strip_prefix("R-")
                .or_else(|| r.id.strip_prefix('R'))
                .and_then(|n| n.parse::<u32>().ok())
        })
        .max()
        .unwrap_or(0);
    format!("R-{:02}", max + 1)
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
    append(
        residual_dir,
        Residue::whole_system(id.clone(), force_id, notes),
    )?;
    Ok(id)
}
