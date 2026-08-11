use anyhow::Result;
use crate::config::Config;
use crate::cli::MatrixOp;

pub mod criticality;
pub mod matrix;
pub mod residual_index;

pub fn run(cfg: &Config, op: MatrixOp) -> Result<()> {
    todo!("dispatch matrix operations")
}
