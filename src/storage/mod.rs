use anyhow::Result;
use crate::config::Config;
use crate::cli::{AddTarget, ListTarget};

pub mod attractors;
pub mod iterations;
pub mod personas;
pub mod purposes;
pub mod research;
pub mod stressors;
pub mod terminology;

pub fn init(cfg: &Config) -> Result<()> {
    todo!("init residual/ directory structure")
}

pub fn add(cfg: &Config, target: AddTarget) -> Result<()> {
    todo!("add entry")
}

pub fn list(cfg: &Config, target: ListTarget) -> Result<()> {
    todo!("list entries")
}
