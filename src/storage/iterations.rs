use anyhow::Result;
use std::path::Path;

pub struct IterationMeta {
    pub n: usize,
    pub date: String,
    pub ri_score: String,
    pub n_val: String,
    pub k_val: String,
    pub p_val: String,
    pub notes: String,
}

pub fn next_n(residual_dir: &Path) -> Result<usize> {
    todo!("find highest existing iteration number + 1")
}

pub fn create(residual_dir: &Path, meta: IterationMeta) -> Result<()> {
    todo!("write iterations/<n>.md with front-matter + empty body")
}

pub fn list(residual_dir: &Path) -> Result<Vec<IterationMeta>> {
    todo!("list all iterations by scanning iterations/ dir")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn make_meta(n: usize) -> IterationMeta {
        IterationMeta {
            n,
            date: "2026-08-11".to_string(),
            ri_score: "0.5".to_string(),
            n_val: "10".to_string(),
            k_val: "5".to_string(),
            p_val: "0.5".to_string(),
            notes: "initial iteration".to_string(),
        }
    }

    #[test]
    fn next_n_empty_dir() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("iterations")).unwrap();
        assert_eq!(next_n(dir.path()).unwrap(), 1);
    }

    #[test]
    fn next_n_with_gaps() {
        let dir = tempdir().unwrap();
        let iters_dir = dir.path().join("iterations");
        std::fs::create_dir_all(&iters_dir).unwrap();
        std::fs::write(iters_dir.join("1.md"), "---\nn: 1\n---\n").unwrap();
        std::fs::write(iters_dir.join("3.md"), "---\nn: 3\n---\n").unwrap();
        assert_eq!(next_n(dir.path()).unwrap(), 4);
    }

    #[test]
    fn create_writes_front_matter() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("iterations")).unwrap();
        create(dir.path(), make_meta(1)).unwrap();
        let content = std::fs::read_to_string(dir.path().join("iterations/1.md")).unwrap();
        assert!(content.contains("date:"), "missing date field");
        assert!(content.contains("ri_score:") || content.contains("ri-score:"), "missing ri_score field");
        assert!(content.contains("n:") || content.contains("n_val:"), "missing n field");
    }

    #[test]
    fn list_parses_created_iterations() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("iterations")).unwrap();
        create(dir.path(), make_meta(1)).unwrap();
        create(dir.path(), make_meta(2)).unwrap();
        let items = list(dir.path()).unwrap();
        assert_eq!(items.len(), 2);
    }
}
