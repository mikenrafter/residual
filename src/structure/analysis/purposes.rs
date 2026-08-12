//! Purposes schema — Force specialization (naive_change + outcomes, not traits).

use super::force::{Force, ForceKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Purpose {
    pub force: Force,
    pub feature: String,
}

impl Purpose {
    pub fn new(id: &str, shortname: &str, naive_change: &str, outcomes: Vec<String>) -> Self {
        Self {
            force: Force {
                id: id.to_string(),
                kind: ForceKind::Purpose,
                shortname: shortname.to_string(),
                naive_change: naive_change.to_string(),
                outcomes,
                description: String::new(),
                attractor_id: String::new(),
            },
            feature: String::new(),
        }
    }

    pub fn as_force(&self) -> &Force {
        &self.force
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::structure::analysis::stressors::Stressor;

    #[test]
    fn purposes_and_stressors_carry_outcomes_not_traits() {
        let p = Purpose::new(
            "P-01",
            "add-purpose",
            "expose add-purpose without a session hub",
            vec!["operator records a purpose against an attractor".into()],
        );
        let s = Stressor::new(
            "S-01",
            "stub-skills",
            "stub skills so binary owns methodology",
            vec!["skill sessions follow binary methodology".into()],
        );
        assert!(!p.as_force().outcomes.is_empty(), "purposes must carry outcomes");
        assert!(!s.as_force().outcomes.is_empty(), "stressors must carry outcomes");
        assert!(matches!(p.as_force().kind, ForceKind::Purpose));
        assert!(matches!(s.as_force().kind, ForceKind::Stressor));
        for debug in [format!("{:?}", p), format!("{:?}", s)] {
            assert!(
                !debug.to_lowercase().contains("trait"),
                "forces must not carry traits, got {debug}"
            );
        }
    }
}
