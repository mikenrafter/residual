//! NKP numeric entrypoints (analysis layer).
//! Phase-skill prose for architecture evaluation methods lives under skills::phases.

use anyhow::Result;
use crate::config::Config;
use crate::cli::MatrixOp;

pub fn run(cfg: &Config, op: MatrixOp) -> Result<()> {
    crate::nkp::run(cfg, op)
}
