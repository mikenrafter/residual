use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub validation: ValidationConfig,
    #[serde(default)]
    pub skills: SkillsConfig,
    #[serde(skip)]
    pub residual_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationConfig {
    #[serde(default = "default_strict")]
    pub strict: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillsConfig {
    #[serde(default = "default_token_warn")]
    pub token_warn: usize,
}

fn default_strict() -> bool { true }
fn default_token_warn() -> usize { 1000 }

impl Default for ValidationConfig {
    fn default() -> Self { Self { strict: default_strict() } }
}

impl Default for SkillsConfig {
    fn default() -> Self { Self { token_warn: default_token_warn() } }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            validation: ValidationConfig::default(),
            skills: SkillsConfig::default(),
            residual_dir: PathBuf::from("residual"),
        }
    }
}

pub fn load() -> Result<Config> {
    let residual_dir = find_residual_dir()?;
    let config_path = residual_dir.join("config.toml");

    let mut cfg = if config_path.exists() {
        let raw = std::fs::read_to_string(&config_path)
            .with_context(|| format!("read {}", config_path.display()))?;
        toml::from_str::<Config>(&raw)
            .with_context(|| format!("parse {}", config_path.display()))?
    } else {
        Config::default()
    };

    cfg.residual_dir = residual_dir;
    Ok(cfg)
}

pub fn print(cfg: &Config) -> Result<()> {
    println!("residual_dir = {}", cfg.residual_dir.display());
    println!("validation.strict = {}", cfg.validation.strict);
    println!("skills.token_warn = {}", cfg.skills.token_warn);
    Ok(())
}

fn find_residual_dir() -> Result<PathBuf> {
    let mut dir = std::env::current_dir().context("get current dir")?;
    loop {
        let candidate = dir.join("residual");
        if candidate.is_dir() {
            return Ok(candidate);
        }
        if !dir.pop() {
            return Ok(PathBuf::from("residual"));
        }
    }
}

pub fn residual_dir(cfg: &Config) -> &Path {
    &cfg.residual_dir
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// Helper: parse a config.toml string with a given residual_dir.
    fn parse_with_dir(toml_str: &str, dir: &Path) -> Config {
        let mut cfg: Config = toml::from_str(toml_str).expect("failed to parse config toml");
        cfg.residual_dir = dir.to_path_buf();
        cfg
    }

    #[test]
    fn defaults_strict_true() {
        let cfg = Config::default();
        assert!(cfg.validation.strict, "default strict should be true");
    }

    #[test]
    fn defaults_token_warn_1000() {
        let cfg = Config::default();
        assert_eq!(cfg.skills.token_warn, 1000);
    }

    #[test]
    fn load_no_config_file_returns_defaults() {
        let dir = tempdir().unwrap();
        // No config.toml in dir — simulate by parsing empty toml
        let cfg = parse_with_dir("", dir.path());
        assert!(cfg.validation.strict, "expected strict=true when no config");
        assert_eq!(cfg.skills.token_warn, 1000);
    }

    #[test]
    fn load_config_with_strict_false() {
        let dir = tempdir().unwrap();
        let toml_str = "[validation]\nstrict = false\n";
        let cfg = parse_with_dir(toml_str, dir.path());
        assert!(!cfg.validation.strict, "expected strict=false when set in config");
    }

    #[test]
    fn load_config_with_custom_token_warn() {
        let dir = tempdir().unwrap();
        let toml_str = "[skills]\ntoken_warn = 500\n";
        let cfg = parse_with_dir(toml_str, dir.path());
        assert_eq!(cfg.skills.token_warn, 500);
    }
}
