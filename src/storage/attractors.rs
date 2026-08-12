use anyhow::Result;
use std::path::Path;

pub use crate::structure::analysis::attractors::Attractor;

pub fn load(residual_dir: &Path) -> Result<Vec<Attractor>> {
    crate::storage::format::read_attractors_v3(residual_dir)
}

pub fn append(residual_dir: &Path, attractor: Attractor) -> Result<()> {
    let mut existing = load(residual_dir)?;
    existing.push(attractor);
    crate::storage::format::write_attractors_v3(residual_dir, &existing)
}

pub fn next_id(attractors: &[Attractor]) -> String {
    let max = attractors
        .iter()
        .filter_map(|a| a.id.strip_prefix("A-").and_then(|n| n.parse::<u32>().ok()))
        .max()
        .unwrap_or(0);
    format!("A-{:02}", max + 1)
}

pub fn exists(residual_dir: &Path, id: &str) -> Result<bool> {
    let attractors = load(residual_dir)?;
    Ok(attractors.iter().any(|a| a.id == id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn make_attractor(id: &str) -> Attractor {
        Attractor {
            id: id.to_string(),
            name: "Stability".to_string(),
            description: "System remains stable".to_string(),
            positive_state: "coherent NKP".to_string(),
            negative_state: "Ri collapses".to_string(),
        }
    }

    #[test]
    fn next_id_empty() {
        assert_eq!(next_id(&[]), "A-01");
    }

    #[test]
    fn next_id_after_a03() {
        let attractors = vec![make_attractor("A-01"), make_attractor("A-03")];
        assert_eq!(next_id(&attractors), "A-04");
    }

    #[test]
    fn exists_returns_false_for_empty_csv() {
        let dir = tempdir().unwrap();
        assert!(!exists(dir.path(), "A-01").unwrap());
    }

    #[test]
    fn exists_returns_true_after_append() {
        let dir = tempdir().unwrap();
        append(dir.path(), make_attractor("A-01")).unwrap();
        assert!(exists(dir.path(), "A-01").unwrap());
    }

    #[test]
    fn attractor_round_trips() {
        let dir = tempdir().unwrap();
        let a = make_attractor("A-01");
        append(dir.path(), a).unwrap();
        let loaded = load(dir.path()).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "A-01");
        assert_eq!(loaded[0].positive_state, "coherent NKP");
        assert_eq!(loaded[0].negative_state, "Ri collapses");
        assert_eq!(loaded[0].name, "Stability");
    }

    #[test]
    fn load_missing_file_returns_empty() {
        let dir = tempdir().unwrap();
        let result = load(dir.path()).unwrap();
        assert!(result.is_empty());
    }
}
