//! Tag scanning — suggestions, not enforcement.
//! One-way tag rule is owned by Verification.

use anyhow::Result;
use crate::config::Config;
use crate::cli::TagOp;

pub fn run(cfg: &Config, op: TagOp) -> Result<()> {
    match op {
        TagOp::Scan { path } => {
            println!("SUGGESTION: tag scan reports dangling/untagged ids; Verification enforces the one-way rule.");
            crate::tags::run(cfg, TagOp::Scan { path })
        }
        TagOp::Report { path } => crate::tags::run(cfg, TagOp::Report { path }),
    }
}
