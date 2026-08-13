use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stressor {
    pub id: String,
    pub description: String,
    pub attractor_id: String,
    pub naive_change: String,
    #[serde(rename = "outcomes", alias = "traits")]
    pub outcomes: String,
    pub components_affected: String,
}

pub fn load(residual_dir: &Path) -> Result<Vec<Stressor>> {
    let path = residual_dir.join("stressors.csv");
    if !path.exists() {
        return Ok(vec![]);
    }
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_path(&path)?;
    let mut result = Vec::new();
    for record in rdr.deserialize() {
        let s: Stressor = record?;
        result.push(s);
    }
    Ok(result)
}

pub fn append(residual_dir: &Path, stressor: Stressor) -> Result<()> {
    let mut all = load(residual_dir)?;
    if all.iter().any(|s| s.id == stressor.id) {
        anyhow::bail!("stressor id '{}' already exists", stressor.id);
    }
    all.push(stressor);
    write_all(residual_dir, &all)
}

fn write_all(residual_dir: &Path, rows: &[Stressor]) -> Result<()> {
    let mut buf = String::from("id,description,naive_change,outcomes,components_affected,attractor_id\n");
    for s in rows {
        let mut row = Vec::new();
        {
            let mut wtr = csv::WriterBuilder::new().has_headers(false).from_writer(&mut row);
            wtr.write_record(&[
                &s.id,
                &s.description,
                &s.naive_change,
                &s.outcomes,
                &s.components_affected,
                &s.attractor_id,
            ])?;
            wtr.flush()?;
        }
        buf.push_str(std::str::from_utf8(&row)?);
    }
    std::fs::write(residual_dir.join("stressors.csv"), buf)?;
    Ok(())
}

pub fn next_id(stressors: &[Stressor]) -> String {
    let max = stressors
        .iter()
        .filter_map(|s| {
            s.id.strip_prefix("S-").and_then(|n| n.parse::<u32>().ok())
        })
        .max()
        .unwrap_or(0);
    format!("S-{:02}", max + 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn make_stressor(id: &str) -> Stressor {
        Stressor {
            id: id.to_string(),
            description: "desc".to_string(),
            attractor_id: "A-01".to_string(),
            naive_change: "change".to_string(),
            outcomes: "system handles auth".to_string(),
            components_affected: "auth,db".to_string(),
        }
    }

    #[test]
    fn next_id_empty() {
        assert_eq!(next_id(&[]), "S-01");
    }

    #[test]
    fn next_id_after_s03() {
        let stressors = vec![make_stressor("S-01"), make_stressor("S-03")];
        assert_eq!(next_id(&stressors), "S-04");
    }

    #[test]
    fn append_creates_file_with_header_and_row() {
        let dir = tempdir().unwrap();
        let s = make_stressor("S-01");
        append(dir.path(), s).unwrap();
        let content = std::fs::read_to_string(dir.path().join("stressors.csv")).unwrap();
        assert!(content.contains("id,"), "header missing");
        assert!(content.contains("S-01"), "row missing");
    }

    #[test]
    fn append_does_not_duplicate_header() {
        let dir = tempdir().unwrap();
        append(dir.path(), make_stressor("S-01")).unwrap();
        append(dir.path(), make_stressor("S-02")).unwrap();
        let content = std::fs::read_to_string(dir.path().join("stressors.csv")).unwrap();
        assert_eq!(content.matches("id,").count(), 1, "header duplicated");
    }

    #[test]
    fn load_reads_back_appended() {
        let dir = tempdir().unwrap();
        append(dir.path(), make_stressor("S-01")).unwrap();
        let loaded = load(dir.path()).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "S-01");
    }

    #[test]
    fn append_rejects_duplicate_id() {
        let dir = tempdir().unwrap();
        append(dir.path(), make_stressor("S-01")).unwrap();
        let err = append(dir.path(), make_stressor("S-01")).unwrap_err();
        assert!(err.to_string().contains("already exists"));
    }

    #[test]
    fn load_missing_file_returns_empty() {
        let dir = tempdir().unwrap();
        let result = load(dir.path()).unwrap();
        assert!(result.is_empty());
    }
}
