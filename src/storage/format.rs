//! Format — current multi-file CSV; round-trip structure.analysis.* and
//! structure.definition.* ↔ CSV.

use anyhow::Result;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use crate::structure::analysis::attractors::Attractor;
use crate::structure::analysis::force::{Force, ForceKind};
use crate::structure::analysis::residues::Residue;
use crate::structure::definition::lexicon::Term;

const FORCES_HEADER: &str = "id,kind,shortname,naive_change,outcomes,description,attractor_id";
const LEXICON_HEADER: &str = "term,definition,domain,aliases";
const RESIDUES_MATRIX_FORCE_COL: &str = "force";
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

fn parse_residue_cell(cell: &str) -> (String, String) {
    if let Some((status, notes)) = cell.split_once('|') {
        (status.trim().to_string(), notes.trim().to_string())
    } else {
        (cell.trim().to_string(), String::new())
    }
}

fn format_residue_cell(status: &str, notes: &str) -> String {
    if notes.is_empty() {
        status.to_string()
    } else {
        format!("{status}|{notes}")
    }
}

fn residues_is_matrix_header(header: &str) -> bool {
    header
        .split(',')
        .next()
        .map(|c| c.trim().eq_ignore_ascii_case(RESIDUES_MATRIX_FORCE_COL))
        .unwrap_or(false)
}

fn residues_to_rows(
    residues: &[Residue],
) -> (
    Vec<String>,
    BTreeMap<String, BTreeMap<String, (String, String)>>,
) {
    let mut components = BTreeSet::new();
    let mut cells: BTreeMap<String, BTreeMap<String, (String, String)>> = BTreeMap::new();
    for r in residues {
        if r.force_id.is_empty() || r.component_id.is_empty() {
            continue;
        }
        components.insert(r.component_id.clone());
        cells
            .entry(r.force_id.clone())
            .or_default()
            .insert(r.component_id.clone(), (r.status.clone(), r.notes.clone()));
    }
    (components.into_iter().collect(), cells)
}

fn render_residues_matrix(residues: &[Residue]) -> String {
    let (components, cells) = residues_to_rows(residues);
    let mut buf = RESIDUES_MATRIX_FORCE_COL.to_string();
    for c in &components {
        buf.push(',');
        buf.push_str(c);
    }
    buf.push('\n');
    for force_id in cells.keys() {
        let force_cells = cells
            .get(force_id)
            .expect("force_id comes from cells.keys()");
        let mut row = vec![force_id.as_str()];
        let mut cell_values = Vec::new();
        for c in &components {
            cell_values.push(
                force_cells
                    .get(c)
                    .map(|(s, n)| format_residue_cell(s, n))
                    .unwrap_or_default(),
            );
        }
        for v in &cell_values {
            row.push(v.as_str());
        }
        let mut out = Vec::new();
        {
            let mut wtr = csv::WriterBuilder::new()
                .has_headers(false)
                .from_writer(&mut out);
            wtr.write_record(&row)
                .expect("csv write to Vec<u8> is infallible");
            wtr.flush().expect("csv flush to Vec<u8> is infallible");
        }
        buf.push_str(
            std::str::from_utf8(&out).expect("csv output is always valid UTF-8"),
        );
    }
    buf
}

pub fn format_residues_matrix(residual_dir: &Path) -> Result<String> {
    Ok(render_residues_matrix(&read_residues(residual_dir)?))
}

pub fn write_residues(residual_dir: &Path, residues: &[Residue]) -> Result<()> {
    std::fs::write(
        residual_dir.join("residues.csv"),
        render_residues_matrix(residues),
    )?;
    Ok(())
}

pub fn read_residues(residual_dir: &Path) -> Result<Vec<Residue>> {
    let path = residual_dir.join("residues.csv");
    if !path.exists() {
        return Ok(vec![]);
    }
    let text = std::fs::read_to_string(&path)?;
    let mut lines = text.lines();
    let header = lines.next().unwrap_or("");
    if header.trim().is_empty() {
        return Ok(vec![]);
    }
    if residues_is_matrix_header(header) {
        return read_residues_matrix(header, lines);
    }
    read_residues_legacy(&path)
}

fn read_residues_matrix<'a, I>(header: &str, rows: I) -> Result<Vec<Residue>>
where
    I: Iterator<Item = &'a str>,
{
    let components: Vec<String> = header
        .split(',')
        .skip(1)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let mut out = Vec::new();
    let mut id_n = 0u32;
    for line in rows {
        if line.trim().is_empty() {
            continue;
        }
        let mut rdr = csv::ReaderBuilder::new()
            .has_headers(false)
            .from_reader(line.as_bytes());
        let rec = rdr.records().next().transpose()?.unwrap_or_default();
        let force_id = rec.get(0).unwrap_or("").trim().to_string();
        if force_id.is_empty() {
            continue;
        }
        for (i, component_id) in components.iter().enumerate() {
            let cell = rec.get(i + 1).unwrap_or("").trim();
            if cell.is_empty() {
                continue;
            }
            id_n += 1;
            let (status, notes) = parse_residue_cell(cell);
            out.push(Residue {
                id: format!("R-{id_n:02}"),
                force_id: force_id.clone(),
                component_id: component_id.clone(),
                status,
                notes,
            });
        }
    }
    Ok(out)
}

fn read_residues_legacy(path: &Path) -> Result<Vec<Residue>> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_path(path)?;
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
        let mut residue = Residue::new("R-01", "S-01", "cli");
        residue.status = "proposed".to_string();
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
