//! Force schema — 1/2 of a residue (the purpose/stressor inside it).
//!
//! A force carries naive_change + outcomes + shortname. It does **not** carry
//! traits or component lists; component mapping lives on Residue.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForceKind {
    Purpose,
    Stressor,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Force {
    pub id: String,
    pub kind: ForceKind,
    pub shortname: String,
    pub naive_change: String,
    pub outcomes: Vec<String>,
    pub description: String,
    pub attractor_id: String,
}

impl Force {
    pub fn purpose(
        id: impl Into<String>,
        shortname: impl Into<String>,
        naive_change: impl Into<String>,
        outcomes: Vec<String>,
    ) -> Self {
        Self {
            id: id.into(),
            kind: ForceKind::Purpose,
            shortname: shortname.into(),
            naive_change: naive_change.into(),
            outcomes,
            description: String::new(),
            attractor_id: String::new(),
        }
    }

    pub fn stressor(
        id: impl Into<String>,
        shortname: impl Into<String>,
        naive_change: impl Into<String>,
        outcomes: Vec<String>,
    ) -> Self {
        Self {
            id: id.into(),
            kind: ForceKind::Stressor,
            shortname: shortname.into(),
            naive_change: naive_change.into(),
            outcomes,
            description: String::new(),
            attractor_id: String::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::structure::analysis::residues::Residue;

    #[test]
    fn force_is_half_of_residue() {
        let force = Force::purpose(
            "P-01",
            "auth-hub",
            "add auth without rewriting the hub",
            vec!["operator authenticates via residue mapping".into()],
        );
        let residue = Residue {
            id: "R-01".into(),
            force_id: force.id.clone(),
            component_id: "cli".into(),
            status: "proposed".into(),
            notes: String::new(),
        };
        assert_eq!(residue.force_id, force.id, "residue maps a force id");
        assert!(!residue.component_id.is_empty(), "residue maps a component id");
        assert_ne!(
            residue.force_id, residue.component_id,
            "force half and component half are distinct"
        );
        assert!(
            !force.outcomes.is_empty(),
            "force carries outcomes (the narrative half)"
        );
        let debug = format!("{:?}", force);
        assert!(
            !debug.to_lowercase().contains("trait"),
            "Force must not carry traits, got {debug}"
        );
        assert!(
            !debug.to_lowercase().contains("component"),
            "Force must not carry component lists, got {debug}"
        );
    }
}
