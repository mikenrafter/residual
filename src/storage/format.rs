//! Format — current multi-file CSV; round-trip structure.analysis.* and
//! structure.definition.* ↔ CSV.

use anyhow::Result;
use std::path::Path;

use crate::structure::analysis::attractors::Attractor;
use crate::structure::analysis::force::{Force, ForceKind};
use crate::structure::analysis::residues::Residue;
use crate::structure::definition::lexicon::Term;

const FORCES_HEADER: &str = "id,kind,shortname,naive_change,outcomes,description,attractor_id";
const LEXICON_HEADER: &str = "term,definition,domain,aliases";
const RESIDUES_HEADER: &str = "id,force_id,component_id,status,notes";
const ATTRACTORS_V3_HEADER: &str = "id,name,description,positive_state,negative_state";

pub fn write_forces(residual_dir: &Path, forces: &[Force]) -> Result<()> {
    let path = residual_dir.join("forces.csv");
    let mut buf = FORCES_HEADER.to_string();
    buf.push('\n');
    for f in forces {
        let kind = match f.kind {
            ForceKind::Purpose => "purpose",
            ForceKind::Stressor => "stressor",
        };
        let outcomes = f.outcomes.join("|");
        let mut row = Vec::new();
        {
            let mut wtr = csv::WriterBuilder::new()
                .has_headers(false)
                .from_writer(&mut row);
            wtr.write_record(&[
                f.id.as_str(),
                kind,
                f.shortname.as_str(),
                f.naive_change.as_str(),
                outcomes.as_str(),
                f.description.as_str(),
                f.attractor_id.as_str(),
            ])?;
            wtr.flush()?;
        }
        buf.push_str(std::str::from_utf8(&row)?);
    }
    std::fs::write(path, buf)?;
    Ok(())
}

pub fn read_forces(residual_dir: &Path) -> Result<Vec<Force>> {
    let path = residual_dir.join("forces.csv");
    if !path.exists() {
        return Ok(vec![]);
    }
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_path(&path)?;
    let mut out = Vec::new();
    for rec in rdr.records() {
        let rec = rec?;
        let kind = match rec.get(1).unwrap_or("").to_lowercase().as_str() {
            "purpose" => ForceKind::Purpose,
            _ => ForceKind::Stressor,
        };
        let outcomes = rec
            .get(4)
            .unwrap_or("")
            .split('|')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();
        out.push(Force {
            id: rec.get(0).unwrap_or("").to_string(),
            kind,
            shortname: rec.get(2).unwrap_or("").to_string(),
            naive_change: rec.get(3).unwrap_or("").to_string(),
            outcomes,
            description: rec.get(5).unwrap_or("").to_string(),
            attractor_id: rec.get(6).unwrap_or("").to_string(),
        });
    }
    Ok(out)
}

pub fn write_lexicon(residual_dir: &Path, terms: &[Term]) -> Result<()> {
    let path = residual_dir.join("lexicon.csv");
    let mut buf = LEXICON_HEADER.to_string();
    buf.push('\n');
    for t in terms {
        let mut row = Vec::new();
        {
            let mut wtr = csv::WriterBuilder::new()
                .has_headers(false)
                .from_writer(&mut row);
            wtr.write_record(&[
                t.term.as_str(),
                t.definition.as_str(),
                t.domain.as_str(),
                t.aliases.as_str(),
            ])?;
            wtr.flush()?;
        }
        buf.push_str(std::str::from_utf8(&row)?);
    }
    std::fs::write(path, buf)?;
    Ok(())
}

pub fn read_lexicon(residual_dir: &Path) -> Result<Vec<Term>> {
    let path = residual_dir.join("lexicon.csv");
    if !path.exists() {
        return Ok(vec![]);
    }
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_path(&path)?;
    let mut out = Vec::new();
    for rec in rdr.deserialize() {
        out.push(rec?);
    }
    Ok(out)
}

pub fn write_residues(residual_dir: &Path, residues: &[Residue]) -> Result<()> {
    let path = residual_dir.join("residues.csv");
    let mut buf = RESIDUES_HEADER.to_string();
    buf.push('\n');
    for r in residues {
        let mut row = Vec::new();
        {
            let mut wtr = csv::WriterBuilder::new()
                .has_headers(false)
                .from_writer(&mut row);
            wtr.write_record(&[
                r.id.as_str(),
                r.force_id.as_str(),
                r.component_id.as_str(),
                r.status.as_str(),
                r.notes.as_str(),
            ])?;
            wtr.flush()?;
        }
        buf.push_str(std::str::from_utf8(&row)?);
    }
    std::fs::write(path, buf)?;
    Ok(())
}

pub fn read_residues(residual_dir: &Path) -> Result<Vec<Residue>> {
    let path = residual_dir.join("residues.csv");
    if !path.exists() {
        return Ok(vec![]);
    }
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_path(&path)?;
    let mut out = Vec::new();
    for rec in rdr.records() {
        let rec = rec?;
        out.push(Residue {
            id: rec.get(0).unwrap_or("").to_string(),
            force_id: rec.get(1).unwrap_or("").to_string(),
            component_id: rec.get(2).unwrap_or("").to_string(),
            status: rec.get(3).unwrap_or("").to_string(),
            notes: rec.get(4).unwrap_or("").to_string(),
        });
    }
    Ok(out)
}

pub fn write_attractors_v3(residual_dir: &Path, attractors: &[Attractor]) -> Result<()> {
    let path = residual_dir.join("attractors.csv");
    let mut buf = ATTRACTORS_V3_HEADER.to_string();
    buf.push('\n');
    for a in attractors {
        let mut row = Vec::new();
        {
            let mut wtr = csv::WriterBuilder::new()
                .has_headers(false)
                .from_writer(&mut row);
            wtr.write_record(&[
                a.id.as_str(),
                a.name.as_str(),
                a.description.as_str(),
                a.positive_state.as_str(),
                a.negative_state.as_str(),
            ])?;
            wtr.flush()?;
        }
        buf.push_str(std::str::from_utf8(&row)?);
    }
    std::fs::write(path, buf)?;
    Ok(())
}

pub fn read_attractors_v3(residual_dir: &Path) -> Result<Vec<Attractor>> {
    let path = residual_dir.join("attractors.csv");
    if !path.exists() {
        return Ok(vec![]);
    }
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_path(&path)?;
    let mut out = Vec::new();
    for rec in rdr.records() {
        let rec = rec?;
        out.push(Attractor {
            id: rec.get(0).unwrap_or("").to_string(),
            name: rec.get(1).unwrap_or("").to_string(),
            description: rec.get(2).unwrap_or("").to_string(),
            positive_state: rec.get(3).unwrap_or("").to_string(),
            negative_state: rec.get(4).unwrap_or("").to_string(),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn format_roundtrips_force_and_lexicon() {
        let dir = tempdir().unwrap();
        let force = Force::stressor(
            "S-01",
            "stub-method",
            "install stubs so binary owns methodology",
            vec!["skill sessions follow binary methodology".into()],
        );
        let term = Term {
            term: "residue".into(),
            definition: "force + component mapping".into(),
            domain: "core".into(),
            aliases: "residual".into(),
        };
        write_forces(dir.path(), &[force.clone()]).unwrap();
        write_lexicon(dir.path(), &[term.clone()]).unwrap();
        let forces = read_forces(dir.path()).unwrap();
        let terms = read_lexicon(dir.path()).unwrap();
        assert_eq!(forces, vec![force]);
        assert_eq!(terms, vec![term]);
    }

    #[test]
    fn format_roundtrips_residues_and_attractors_v3() {
        let dir = tempdir().unwrap();
        let residue = Residue::new("R-01", "S-01", "cli");
        let attractor = Attractor::new(
            "A-01",
            "Clarity",
            "NKP data reflects stress surface",
            "Ri collapses; stressors undefined",
        );
        write_residues(dir.path(), &[residue.clone()]).unwrap();
        write_attractors_v3(dir.path(), &[attractor.clone()]).unwrap();
        assert_eq!(read_residues(dir.path()).unwrap(), vec![residue]);
        assert_eq!(read_attractors_v3(dir.path()).unwrap(), vec![attractor]);
    }
}
