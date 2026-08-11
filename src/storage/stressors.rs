use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stressor {
    pub id: String,
    pub description: String,
    pub attractor_id: String,
    pub naive_change: String,
    pub traits: String,
    pub components_affected: String,
}

pub fn load(residual_dir: &Path) -> Result<Vec<Stressor>> {
    todo!("load stressors.csv")
}

pub fn append(residual_dir: &Path, stressor: Stressor) -> Result<()> {
    todo!("append stressor to csv")
}

pub fn next_id(stressors: &[Stressor]) -> String {
    todo!("generate next stressor id")
}
