//! Stressors schema — Force specialization (naive_change + outcomes, not traits).

use super::force::{Force, ForceKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stressor {
    pub force: Force,
    /// Optional detection hook (S-14) — field on Force/Stressors, not a component.
    pub detection_mechanism: String,
}

impl Stressor {
    pub fn new(id: &str, shortname: &str, naive_change: &str, outcomes: Vec<String>) -> Self {
        Self {
            force: Force {
                id: id.to_string(),
                kind: ForceKind::Stressor,
                shortname: shortname.to_string(),
                naive_change: naive_change.to_string(),
                outcomes,
                description: String::new(),
                attractor_id: String::new(),
            },
            detection_mechanism: String::new(),
        }
    }

    pub fn as_force(&self) -> &Force {
        &self.force
    }
}
