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
