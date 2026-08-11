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
    let iters_dir = residual_dir.join("iterations");
    if !iters_dir.exists() {
        return Ok(1);
    }
    let max = std::fs::read_dir(&iters_dir)?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.extension()?.to_str()? != "md" {
                return None;
            }
            let stem = path.file_stem()?.to_str()?.to_string();
            stem.parse::<usize>().ok()
        })
        .max()
        .unwrap_or(0);
    Ok(max + 1)
}

pub fn create(residual_dir: &Path, meta: IterationMeta) -> Result<()> {
    let iters_dir = residual_dir.join("iterations");
    std::fs::create_dir_all(&iters_dir)?;
    let path = iters_dir.join(format!("{}.md", meta.n));
    let content = format!(
        "---\ndate: \"{}\"\nri_score: \"{}\"\nn: \"{}\"\nk: \"{}\"\np: \"{}\"\nnotes: \"{}\"\n---\n",
        meta.date, meta.ri_score, meta.n_val, meta.k_val, meta.p_val, meta.notes
    );
    std::fs::write(&path, content)?;
    Ok(())
}

pub fn list(residual_dir: &Path) -> Result<Vec<IterationMeta>> {
    let iters_dir = residual_dir.join("iterations");
    if !iters_dir.exists() {
        return Ok(vec![]);
    }
    let mut items = Vec::new();
    for entry in std::fs::read_dir(&iters_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(0);
        let content = std::fs::read_to_string(&path)?;
        let meta = parse_front_matter(&content, stem);
        items.push(meta);
    }
    Ok(items)
}

fn parse_front_matter(content: &str, n: usize) -> IterationMeta {
    let mut date = String::new();
    let mut ri_score = String::new();
    let mut n_val = String::new();
    let mut k_val = String::new();
    let mut p_val = String::new();
    let mut notes = String::new();

    // Extract content between first --- and second ---
    let inner = if content.starts_with("---") {
        let after = &content[3..];
        if let Some(end) = after.find("---") {
            &after[..end]
        } else {
            ""
        }
    } else {
        ""
    };

    for line in inner.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("date:") {
            date = rest.trim().trim_matches('"').to_string();
        } else if let Some(rest) = line.strip_prefix("ri_score:") {
            ri_score = rest.trim().trim_matches('"').to_string();
        } else if let Some(rest) = line.strip_prefix("n:") {
            n_val = rest.trim().trim_matches('"').to_string();
        } else if let Some(rest) = line.strip_prefix("k:") {
            k_val = rest.trim().trim_matches('"').to_string();
        } else if let Some(rest) = line.strip_prefix("p:") {
            p_val = rest.trim().trim_matches('"').to_string();
        } else if let Some(rest) = line.strip_prefix("notes:") {
            notes = rest.trim().trim_matches('"').to_string();
        }
    }

    IterationMeta { n, date, ri_score, n_val, k_val, p_val, notes }
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
