use anyhow::Result;

mod cli;
mod config;
mod nkp;
mod skills;
mod storage;
mod tags;
mod verify;

fn main() -> Result<()> {
    cli::run()
}
