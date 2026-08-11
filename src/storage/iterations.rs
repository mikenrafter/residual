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
