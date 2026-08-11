use anyhow::Result;
use crate::config::Config;
use crate::cli::TagOp;
use std::collections::HashSet;

pub fn run(cfg: &Config, op: TagOp) -> Result<()> {
    match op {
        TagOp::Scan { path } => {
            let tags = scan_dir(&path)?;

            // Load stressor IDs from storage
            let stressors = crate::storage::stressors::load(&cfg.residual_dir).unwrap_or_default();
            let stored_stressor_ids: HashSet<String> =
                stressors.iter().map(|s| s.id.clone()).collect();

            // Collect all tagged IDs
            let mut tagged_residue_ids: HashSet<String> = HashSet::new();
            let mut tagged_stressor_ids: HashSet<String> = HashSet::new();
            for tag in &tags {
                match tag.kind {
                    TagKind::Residue => {
                        for id in &tag.ids {
                            tagged_residue_ids.insert(id.clone());
                        }
                    }
                    TagKind::Stressor => {
                        for id in &tag.ids {
                            tagged_stressor_ids.insert(id.clone());
                        }
                    }
                }
            }

            // Dangling stressor tags: in tags but not in storage
            let dangling: Vec<&String> = tagged_stressor_ids
                .iter()
                .filter(|id| !stored_stressor_ids.contains(*id))
                .collect();

            // Untagged stressors: in storage but not in any tag
            let untagged: Vec<&String> = stored_stressor_ids
                .iter()
                .filter(|id| !tagged_stressor_ids.contains(*id))
                .collect();

            if dangling.is_empty() && untagged.is_empty() {
                println!("All tags valid and all stressors tagged.");
            } else {
                for id in &dangling {
                    println!("DANGLING: {} (in code but not in storage)", id);
                }
                for id in &untagged {
                    println!("UNTAGGED: {} (in storage but not referenced in code)", id);
                }
            }
        }
        TagOp::Report { path } => {
            let tags = scan_dir(&path)?;
            if tags.is_empty() {
                println!("No tags found.");
            } else {
                for tag in &tags {
                    let kind_str = match tag.kind {
                        TagKind::Residue  => "@residue",
                        TagKind::Stressor => "@stressor",
                    };
                    println!("{}:{} → {} {}", tag.file, tag.line, kind_str, tag.ids.join(", "));
                }
            }
        }
    }
    Ok(())
}

pub struct Tag {
    pub file: String,
    pub line: usize,
    pub kind: TagKind,
    pub ids: Vec<String>,
}

pub enum TagKind {
    Residue,
    Stressor,
}

pub fn scan_dir(path: &str) -> Result<Vec<Tag>> {
    let root = std::path::Path::new(path);
    let mut tags = Vec::new();
    scan_path(root, &mut tags)?;
    Ok(tags)
}

fn scan_path(path: &std::path::Path, tags: &mut Vec<Tag>) -> Result<()> {
    if path.is_dir() {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let child = entry.path();
            // Skip hidden directories (e.g. .git)
            if let Some(name) = child.file_name().and_then(|n| n.to_str()) {
                if name.starts_with('.') {
                    continue;
                }
            }
            scan_path(&child, tags)?;
        }
    } else if path.is_file() {
        scan_file(path, tags)?;
    }
    Ok(())
}

fn scan_file(path: &std::path::Path, tags: &mut Vec<Tag>) -> Result<()> {
    // Read as bytes first to detect binary files
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(_) => return Ok(()), // skip unreadable files
    };

    // Heuristic: skip binary files (contains null bytes)
    if bytes.contains(&0u8) {
        return Ok(());
    }

    let content = match std::str::from_utf8(&bytes) {
        Ok(s) => s,
        Err(_) => return Ok(()), // skip non-UTF8
    };

    let file_str = path.to_string_lossy().to_string();

    for (line_idx, line) in content.lines().enumerate() {
        let line_num = line_idx + 1;

        if let Some(ids) = extract_tag(line, "@residue:") {
            if !ids.is_empty() {
                tags.push(Tag {
                    file: file_str.clone(),
                    line: line_num,
                    kind: TagKind::Residue,
                    ids,
                });
            }
        }

        if let Some(ids) = extract_tag(line, "@stressor:") {
            if !ids.is_empty() {
                tags.push(Tag {
                    file: file_str.clone(),
                    line: line_num,
                    kind: TagKind::Stressor,
                    ids,
                });
            }
        }
    }

    Ok(())
}

/// Extract IDs after a tag marker within a comment context.
/// Returns Some(ids) if the tag marker is found, None otherwise.
fn extract_tag(line: &str, marker: &str) -> Option<Vec<String>> {
    // Find the marker in the line (comment lines contain it anywhere)
    let pos = line.find(marker)?;
    let after = &line[pos + marker.len()..];

    // Parse comma-separated IDs (e.g. "R-01, R-02" or "S-01")
    let ids: Vec<String> = after
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && (s.starts_with("R-") || s.starts_with("S-") || s.starts_with("P-")))
        .collect();

    Some(ids)
}
