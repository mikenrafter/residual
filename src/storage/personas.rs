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
    todo!("write personas/<name>.md with front-matter")
}

pub fn load_all(residual_dir: &Path) -> Result<Vec<Persona>> {
    todo!("load all personas/*.md files")
}

pub fn list_names(residual_dir: &Path) -> Result<Vec<String>> {
    todo!("list persona file names")
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
