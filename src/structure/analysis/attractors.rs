//! Attractors schema — positive_state + negative_state; no valence field.
//!
//! Legacy CSV may still store valence until migration.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attractor {
    pub id: String,
    pub name: String,
    pub description: String,
    pub positive_state: String,
    pub negative_state: String,
}

impl Attractor {
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        positive_state: impl Into<String>,
        negative_state: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            description: String::new(),
            positive_state: positive_state.into(),
            negative_state: negative_state.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attractors_have_positive_and_negative_state_not_valence() {
        let a = Attractor::new(
            "A-01",
            "Architecture Clarity",
            "NKP data reflects the stress surface",
            "stressors are undefined; Ri collapses",
        );
        assert!(!a.positive_state.is_empty());
        assert!(!a.negative_state.is_empty());
        let debug = format!("{:?}", a);
        assert!(
            !debug.contains("valence"),
            "new attractor type must not have valence, got {debug}"
        );
    }
}
