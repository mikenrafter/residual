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
    let personas_dir = residual_dir.join("personas");
    std::fs::create_dir_all(&personas_dir)?;
    let path = personas_dir.join(format!("{}.md", persona.name));
    let ids_list = persona
        .stressor_ids
        .iter()
        .map(|id| format!("  - \"{}\"", id))
        .collect::<Vec<_>>()
        .join("\n");
    let stressor_ids_str = if persona.stressor_ids.is_empty() {
        "[]".to_string()
    } else {
        format!("\n{}", ids_list)
    };
    let content = format!(
        "---\nrole: \"{}\"\nconcerns: \"{}\"\ndesires: \"{}\"\nstressor_ids: {}\n---\n",
        persona.role, persona.concerns, persona.desires, stressor_ids_str
    );
    std::fs::write(&path, content)?;
    Ok(())
}

pub fn load_all(residual_dir: &Path) -> Result<Vec<Persona>> {
    let personas_dir = residual_dir.join("personas");
    if !personas_dir.exists() {
        return Ok(vec![]);
    }
    let mut result = Vec::new();
    for entry in std::fs::read_dir(&personas_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let content = std::fs::read_to_string(&path)?;
        let persona = parse_persona(&content, name);
        result.push(persona);
    }
    Ok(result)
}

pub fn list_names(residual_dir: &Path) -> Result<Vec<String>> {
    let personas_dir = residual_dir.join("personas");
    if !personas_dir.exists() {
        return Ok(vec![]);
    }
    let mut names = Vec::new();
    for entry in std::fs::read_dir(&personas_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            names.push(stem.to_string());
        }
    }
    Ok(names)
}

fn parse_persona(content: &str, name: String) -> Persona {
    let mut role = String::new();
    let mut concerns = String::new();
    let mut desires = String::new();
    let mut stressor_ids = Vec::new();

    // Extract front-matter between --- delimiters
    let inner = if content.starts_with("---") {
        let after = &content[3..];
        if let Some(end) = after.find("---") {
            &after[..end]
        } else {
            ""
        }
    } else {
        ""
    };

    let mut in_stressor_ids = false;
    for line in inner.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("role:") {
            role = rest.trim().trim_matches('"').to_string();
            in_stressor_ids = false;
        } else if let Some(rest) = trimmed.strip_prefix("concerns:") {
            concerns = rest.trim().trim_matches('"').to_string();
            in_stressor_ids = false;
        } else if let Some(rest) = trimmed.strip_prefix("desires:") {
            desires = rest.trim().trim_matches('"').to_string();
            in_stressor_ids = false;
        } else if trimmed.starts_with("stressor_ids:") {
            in_stressor_ids = true;
        } else if in_stressor_ids && trimmed.starts_with("- ") {
            let id = trimmed[2..].trim().trim_matches('"').to_string();
            if !id.is_empty() {
                stressor_ids.push(id);
            }
        } else if !trimmed.is_empty() && !trimmed.starts_with('-') {
            in_stressor_ids = false;
        }
    }

    Persona { name, role, concerns, desires, stressor_ids }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn make_persona(name: &str) -> Persona {
        Persona {
            name: name.to_string(),
            role: "engineer".to_string(),
            concerns: "performance".to_string(),
            desires: "reliability".to_string(),
            stressor_ids: vec!["S-01".to_string(), "S-02".to_string()],
        }
    }

    #[test]
    fn create_writes_persona_file() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("personas")).unwrap();
        create(dir.path(), make_persona("alice")).unwrap();
        let path = dir.path().join("personas/alice.md");
        assert!(path.exists(), "persona file not created");
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("role:"), "missing role field");
    }

    #[test]
    fn list_names_finds_created_persona() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("personas")).unwrap();
        create(dir.path(), make_persona("alice")).unwrap();
        let names = list_names(dir.path()).unwrap();
        assert!(names.iter().any(|n| n == "alice"), "alice not in list");
    }

    #[test]
    fn load_all_parses_persona() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("personas")).unwrap();
        create(dir.path(), make_persona("alice")).unwrap();
        let personas = load_all(dir.path()).unwrap();
        assert_eq!(personas.len(), 1);
        assert_eq!(personas[0].name, "alice");
        assert_eq!(personas[0].role, "engineer");
    }
}
