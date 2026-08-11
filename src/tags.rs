use anyhow::Result;
use crate::config::Config;
use crate::cli::TagOp;

pub fn run(cfg: &Config, op: TagOp) -> Result<()> {
    todo!("dispatch tag operations")
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
    todo!("walk files, extract @residue: and @stressor: comments")
}
