//! +/- Residues schema — force ↔ component mapping.
//!
//! A residue does **not** hold the force narrative; that lives on Force.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Residue {
    pub id: String,
    pub force_id: String,
    pub component_id: String,
    pub status: String,
    pub notes: String,
}

impl Residue {
    pub fn new(
        id: impl Into<String>,
        force_id: impl Into<String>,
        component_id: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            force_id: force_id.into(),
            component_id: component_id.into(),
            status: String::new(),
            notes: String::new(),
        }
    }
}
