use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Purpose {
    pub id: String,
    #[serde(default)]
    pub shortname: String,
    pub description: String,
    pub attractor_id: String,
    #[serde(alias = "feature")]
    pub naive_change: String,
    #[serde(rename = "outcomes", alias = "traits")]
    pub outcomes: String,
    #[serde(alias = "components_enabled")]
    pub components: String,
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
    let mut all = load(residual_dir)?;
    if all.iter().any(|p| p.id == purpose.id) {
        anyhow::bail!("purpose id '{}' already exists", purpose.id);
    }
    all.push(purpose);
    write_all(residual_dir, &all)
}

pub fn write_all_pub(residual_dir: &Path, rows: &[Purpose]) -> Result<()> {
    write_all(residual_dir, rows)
}

fn write_all(residual_dir: &Path, rows: &[Purpose]) -> Result<()> {
    let mut buf = String::from("id,shortname,description,naive_change,outcomes,components,attractor_id\n");
    for p in rows {
        let mut row = Vec::new();
        {
            let mut wtr = csv::WriterBuilder::new().has_headers(false).from_writer(&mut row);
            wtr.write_record(&[
                &p.id,
                &p.shortname,
                &p.description,
                &p.naive_change,
                &p.outcomes,
                &p.components,
                &p.attractor_id,
            ])?;
            wtr.flush()?;
        }
        buf.push_str(std::str::from_utf8(&row)?);
    }
    std::fs::write(residual_dir.join("purposes.csv"), buf)?;
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
            shortname: String::new(),
            description: "desc".to_string(),
            attractor_id: "A-01".to_string(),
            naive_change: "feat".to_string(),
            outcomes: "system enables login".to_string(),
            components: "auth,ui".to_string(),
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
    fn append_rejects_duplicate_id() {
        let dir = tempdir().unwrap();
        append(dir.path(), make_purpose("P-01")).unwrap();
        let err = append(dir.path(), make_purpose("P-01")).unwrap_err();
        assert!(err.to_string().contains("already exists"));
    }

    #[test]
    fn load_missing_file_returns_empty() {
        let dir = tempdir().unwrap();
        let result = load(dir.path()).unwrap();
        assert!(result.is_empty());
    }

    // --- shortname field tests (RED: shortname field not yet on Purpose) ---

    #[test]
    fn purpose_with_shortname_roundtrips() {
        let dir = tempdir().unwrap();
        let p = Purpose {
            id: "P-01".to_string(),
            description: "test purpose".to_string(),
            attractor_id: "A-01".to_string(),
            naive_change: "add purpose cli".to_string(),
            outcomes: "operator adds purposes".to_string(),
            components: "cli".to_string(),
            shortname: "persona-subagent-depth".to_string(),
        };
        append(dir.path(), p).unwrap();
        let loaded = load(dir.path()).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].shortname, "persona-subagent-depth");
    }

    #[test]
    fn purpose_missing_shortname_column_deserializes_empty() {
        let dir = tempdir().unwrap();
        // Write a purposes.csv with the OLD header (no shortname column).
        std::fs::write(
            dir.path().join("purposes.csv"),
            "id,description,naive_change,outcomes,components,attractor_id\n\
             P-01,old purpose,old naive_change,system enables old,cli,A-01\n",
        )
        .unwrap();
        let loaded = load(dir.path()).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(
            loaded[0].shortname, "",
            "old CSV rows without shortname column should deserialize to empty string"
        );
    }
}
