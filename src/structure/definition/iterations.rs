//! Iterations schema — n/k/p, notes, iteration-complete, component name list.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Iteration {
    pub n: usize,
    pub date: String,
    pub ri_score: String,
    pub n_val: String,
    pub k_val: String,
    pub p_val: String,
    pub notes: String,
    pub iteration_complete: bool,
    pub component_names: Vec<String>,
}

impl Iteration {
    pub fn new(n: usize) -> Self {
        Self {
            n,
            date: String::new(),
            ri_score: String::new(),
            n_val: String::new(),
            k_val: String::new(),
            p_val: String::new(),
            notes: String::new(),
            iteration_complete: false,
            component_names: Vec::new(),
        }
    }
}
