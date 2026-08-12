use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Purpose {
    pub id: String,
    pub description: String,
    pub attractor_id: String,
    pub feature: String,
    #[serde(rename = "outcomes", alias = "traits")]
    pub outcomes: String,
    pub components_enabled: String,
}

pub fn load(residual_dir: &Path) -> Result<Vec<Purpose>> {
    let path = residual_dir.join("purposes.csv");
    if !path.exists() {
        return Ok(vec![]);
    }
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_path(&path)?;
    let mut result = Vec::new();
    for record in rdr.deserialize() {
        let p: Purpose = record?;
        result.push(p);
    }
    Ok(result)
}

pub fn append(residual_dir: &Path, purpose: Purpose) -> Result<()> {
    let path = residual_dir.join("purposes.csv");
    let file_exists = path.exists() && std::fs::metadata(&path).map(|m| m.len() > 0).unwrap_or(false);
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    if !file_exists {
        writeln!(file, "id,description,feature,outcomes,components_enabled,attractor_id")?;
    }
    let mut buf = Vec::new();
    {
        let mut wtr = csv::WriterBuilder::new()
            .has_headers(false)
            .from_writer(&mut buf);
        wtr.write_record(&[
            &purpose.id,
            &purpose.description,
            &purpose.feature,
            &purpose.outcomes,
            &purpose.components_enabled,
            &purpose.attractor_id,
        ])?;
        wtr.flush()?;
    }
    file.write_all(&buf)?;
    Ok(())
}

pub fn next_id(purposes: &[Purpose]) -> String {
    let max = purposes
        .iter()
        .filter_map(|p| {
            p.id.strip_prefix("P-").and_then(|n| n.parse::<u32>().ok())
        })
        .max()
        .unwrap_or(0);
    format!("P-{:02}", max + 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn make_purpose(id: &str) -> Purpose {
        Purpose {
            id: id.to_string(),
            description: "desc".to_string(),
            attractor_id: "A-01".to_string(),
            feature: "feat".to_string(),
            outcomes: "system enables login".to_string(),
            components_enabled: "auth,ui".to_string(),
        }
    }

    #[test]
    fn next_id_empty() {
        assert_eq!(next_id(&[]), "P-01");
    }

    #[test]
    fn next_id_after_p03() {
        let purposes = vec![make_purpose("P-01"), make_purpose("P-03")];
        assert_eq!(next_id(&purposes), "P-04");
    }

    #[test]
    fn append_creates_file_with_header_and_row() {
        let dir = tempdir().unwrap();
        append(dir.path(), make_purpose("P-01")).unwrap();
        let content = std::fs::read_to_string(dir.path().join("purposes.csv")).unwrap();
        assert!(content.contains("id,"), "header missing");
        assert!(content.contains("P-01"), "row missing");
    }

    #[test]
    fn append_does_not_duplicate_header() {
        let dir = tempdir().unwrap();
        append(dir.path(), make_purpose("P-01")).unwrap();
        append(dir.path(), make_purpose("P-02")).unwrap();
        let content = std::fs::read_to_string(dir.path().join("purposes.csv")).unwrap();
        assert_eq!(content.matches("id,").count(), 1, "header duplicated");
    }

    #[test]
    fn load_reads_back_appended() {
        let dir = tempdir().unwrap();
        append(dir.path(), make_purpose("P-01")).unwrap();
        let loaded = load(dir.path()).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "P-01");
    }

    #[test]
    fn load_missing_file_returns_empty() {
        let dir = tempdir().unwrap();
        let result = load(dir.path()).unwrap();
        assert!(result.is_empty());
    }
}
