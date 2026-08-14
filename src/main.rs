#![cfg_attr(test, allow(clippy::unwrap_used))]
use anyhow::Result;

mod cli;
mod config;
mod nkp;
mod skills;
mod storage;
mod structure;
mod tags;
mod verification;
mod verify;

fn main() -> Result<()> {
    cli::run()
}
