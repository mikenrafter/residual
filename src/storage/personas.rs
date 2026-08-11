use anyhow::Result;
use std::path::Path;

pub struct Persona {
    pub name: String,
    pub role: String,
    pub concerns: String,
    pub desires: String,
    pub stressor_ids: Vec<String>,
}

pub fn create(residual_dir: &Path, persona: Persona) -> Result<()> {
    todo!("write personas/<name>.md with front-matter")
}

pub fn load_all(residual_dir: &Path) -> Result<Vec<Persona>> {
    todo!("load all personas/*.md files")
}

pub fn list_names(residual_dir: &Path) -> Result<Vec<String>> {
    todo!("list persona file names")
}
