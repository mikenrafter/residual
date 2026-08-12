//! Components schema — registry, status, architecture_set.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Component {
    pub name: String,
    pub description: String,
    pub status: String,
    pub architecture_set: String,
}

pub fn load(residual_dir: &Path) -> Result<Vec<Component>> {
    let path = residual_dir.join("components.csv");
    if !path.exists() {
        return Ok(vec![]);
    }
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_path(&path)?;
    let mut result = Vec::new();
    for record in rdr.deserialize() {
        result.push(record?);
    }
    Ok(result)
}

pub fn filter_architecture_set<'a>(
    components: &'a [Component],
    set: &str,
) -> Vec<&'a Component> {
    components
        .iter()
        .filter(|c| c.architecture_set == set)
        .collect()
}
