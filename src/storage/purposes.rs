use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Purpose {
    pub id: String,
    pub description: String,
    pub attractor_id: String,
    pub feature: String,
    pub traits: String,
    pub components_enabled: String,
}

pub fn load(residual_dir: &Path) -> Result<Vec<Purpose>> {
    todo!("load purposes.csv")
}

pub fn append(residual_dir: &Path, purpose: Purpose) -> Result<()> {
    todo!("append purpose to csv")
}

pub fn next_id(purposes: &[Purpose]) -> String {
    todo!("generate next purpose id")
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
            traits: "system enables login".to_string(),
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
