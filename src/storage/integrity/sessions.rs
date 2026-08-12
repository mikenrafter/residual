//! Sessions — locks, change-detection hash, append logic, flag when diff/--force is needed.

use anyhow::{bail, Context, Result};
use std::collections::BTreeMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const LOCK_NAME: &str = ".session.lock";
const SNAPSHOT_NAME: &str = ".storage-hashes";
const DEFAULT_TTL_SECS: u64 = 30;

#[derive(Debug)]
pub struct SessionLock {
    path: PathBuf,
}

impl SessionLock {
    pub fn path(residual_dir: &Path) -> PathBuf {
        residual_dir.join(LOCK_NAME)
    }

    pub fn acquire(residual_dir: &Path) -> Result<Self> {
        fs::create_dir_all(residual_dir)?;
        let path = Self::path(residual_dir);
        if path.exists() {
            if is_stale(&path, DEFAULT_TTL_SECS)? {
                let _ = fs::remove_file(&path);
            } else {
                bail!(
                    "session lock held at {} — another mutation in progress",
                    path.display()
                );
            }
        }
        let pid = std::process::id();
        let now = now_secs();
        fs::write(&path, format!("pid={}\nacquired={}\n", pid, now))
            .with_context(|| format!("write lock {}", path.display()))?;
        Ok(Self { path })
    }

    pub fn release(self) -> Result<()> {
        if self.path.exists() {
            fs::remove_file(&self.path)
                .with_context(|| format!("release lock {}", self.path.display()))?;
        }
        Ok(())
    }
}

impl Drop for SessionLock {
    fn drop(&mut self) {
        if self.path.exists() {
            let _ = fs::remove_file(&self.path);
        }
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_secs()
}

fn is_stale(path: &Path, ttl_secs: u64) -> Result<bool> {
    let contents = fs::read_to_string(path)?;
    let acquired = contents
        .lines()
        .find_map(|l| l.strip_prefix("acquired=").and_then(|v| v.parse::<u64>().ok()))
        .unwrap_or(0);
    Ok(now_secs().saturating_sub(acquired) > ttl_secs)
}

pub fn managed_rel_paths(residual_dir: &Path) -> Result<Vec<String>> {
    let mut paths = vec![
        "stressors.csv".to_string(),
        "purposes.csv".to_string(),
        "attractors.csv".to_string(),
        "terminology.csv".to_string(),
        "forces.csv".to_string(),
        "lexicon.csv".to_string(),
        "residues.csv".to_string(),
        "components.csv".to_string(),
        "config.toml".to_string(),
    ];
    for sub in &["personas", "iterations", "research"] {
        let dir = residual_dir.join(sub);
        if !dir.is_dir() {
            continue;
        }
        let mut entries: Vec<_> = fs::read_dir(&dir)?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_file())
            .collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().into_owned();
            paths.push(format!("{}/{}", sub, name));
        }
    }
    paths.sort();
    Ok(paths)
}

fn hash_bytes(data: &[u8]) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    data.hash(&mut hasher);
    hasher.finish()
}

pub fn current_hashes(residual_dir: &Path) -> Result<BTreeMap<String, String>> {
    let mut map = BTreeMap::new();
    for rel in managed_rel_paths(residual_dir)? {
        let path = residual_dir.join(&rel);
        let digest = if path.exists() {
            let bytes = fs::read(&path).with_context(|| format!("read {}", path.display()))?;
            format!("{:016x}", hash_bytes(&bytes))
        } else {
            "missing".to_string()
        };
        map.insert(rel, digest);
    }
    Ok(map)
}

pub fn snapshot_path(residual_dir: &Path) -> PathBuf {
    residual_dir.join(SNAPSHOT_NAME)
}

pub fn write_snapshot(residual_dir: &Path) -> Result<()> {
    let hashes = current_hashes(residual_dir)?;
    let mut body = String::from("# storage integrity change-detection snapshot\n");
    for (path, digest) in &hashes {
        body.push_str(&format!("{}={}\n", path, digest));
    }
    fs::write(snapshot_path(residual_dir), body)
        .with_context(|| format!("write {}", snapshot_path(residual_dir).display()))?;
    Ok(())
}

pub fn load_snapshot(residual_dir: &Path) -> Result<Option<BTreeMap<String, String>>> {
    let path = snapshot_path(residual_dir);
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path)?;
    let mut map = BTreeMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            map.insert(k.to_string(), v.to_string());
        }
    }
    Ok(Some(map))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DriftReport {
    pub drifted: Vec<String>,
    pub added: Vec<String>,
    pub removed: Vec<String>,
}

impl DriftReport {
    pub fn is_clean(&self) -> bool {
        self.drifted.is_empty() && self.added.is_empty() && self.removed.is_empty()
    }
}

pub fn detect_drift(residual_dir: &Path) -> Result<DriftReport> {
    let Some(baseline) = load_snapshot(residual_dir)? else {
        return Ok(DriftReport {
            drifted: vec![],
            added: vec![],
            removed: vec![],
        });
    };
    let current = current_hashes(residual_dir)?;
    let mut drifted = Vec::new();
    let mut added = Vec::new();
    let mut removed = Vec::new();

    for (path, digest) in &current {
        match baseline.get(path) {
            Some(prev) if prev != digest => drifted.push(path.clone()),
            Some(_) => {}
            None => added.push(path.clone()),
        }
    }
    for path in baseline.keys() {
        if !current.contains_key(path) {
            removed.push(path.clone());
        }
    }
    Ok(DriftReport {
        drifted,
        added,
        removed,
    })
}

#[derive(Debug)]
pub struct SessionGuard {
    _lock: SessionLock,
    residual_dir: PathBuf,
}

/// Begin a mutating session. On snapshot drift, require `--force` (or inspect diff).
pub fn begin_mutation(residual_dir: &Path, force: bool) -> Result<SessionGuard> {
    let lock = SessionLock::acquire(residual_dir)?;
    let drift = detect_drift(residual_dir)?;
    if !drift.is_clean() && !force {
        let mut parts = Vec::new();
        if !drift.drifted.is_empty() {
            parts.push(format!("changed: {}", drift.drifted.join(", ")));
        }
        if !drift.added.is_empty() {
            parts.push(format!("added: {}", drift.added.join(", ")));
        }
        if !drift.removed.is_empty() {
            parts.push(format!("removed: {}", drift.removed.join(", ")));
        }
        bail!(
            "residual data drifted outside this session ({}); pass --force to overwrite or inspect diff",
            parts.join("; ")
        );
    }
    Ok(SessionGuard {
        _lock: lock,
        residual_dir: residual_dir.to_path_buf(),
    })
}

impl SessionGuard {
    pub fn commit(self) -> Result<()> {
        write_snapshot(&self.residual_dir)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn sessions_require_force_flag_on_drift() {
        let dir = tempdir().unwrap();
        let residual = dir.path().join("residual");
        fs::create_dir_all(&residual).unwrap();
        fs::write(
            residual.join("terminology.csv"),
            "term,definition,domain,related_terms\n",
        )
        .unwrap();
        fs::write(residual.join("config.toml"), "#\n").unwrap();
        write_snapshot(&residual).unwrap();
        assert!(detect_drift(&residual).unwrap().is_clean());

        let mut terms = fs::read_to_string(residual.join("terminology.csv")).unwrap();
        terms.push_str("smuggled,x,core,\n");
        fs::write(residual.join("terminology.csv"), terms).unwrap();

        let err = begin_mutation(&residual, false).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("--force"),
            "drift without force must mention --force, got {msg}"
        );
        assert!(
            msg.contains("diff") || msg.contains("drift"),
            "drift error should flag diff, got {msg}"
        );

        let guard = begin_mutation(&residual, true).unwrap();
        guard.commit().unwrap();
        assert!(detect_drift(&residual).unwrap().is_clean());
    }
}
