use anyhow::Result;
use std::path::PathBuf;

pub enum Agent {
    Claude,
    Cursor,
    Copilot,
    Agnostic,
}

impl std::str::FromStr for Agent {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Self> {
        match s {
            "claude"   => Ok(Agent::Claude),
            "cursor"   => Ok(Agent::Cursor),
            "copilot"  => Ok(Agent::Copilot),
            "agnostic" => Ok(Agent::Agnostic),
            other => anyhow::bail!("unknown agent '{}': must be claude, cursor, copilot, or agnostic", other),
        }
    }
}

pub fn install_path(name: &str, agent: &Agent, global: bool) -> Result<PathBuf> {
    todo!("resolve installation path for agent + scope")
}

pub fn installed_version(name: &str, agent: &Agent, global: bool) -> Result<Option<u32>> {
    todo!("read version from installed skill front-matter")
}

pub fn write_skill(path: &PathBuf, content: &str) -> Result<()> {
    todo!("create parent dirs + write skill file")
}
