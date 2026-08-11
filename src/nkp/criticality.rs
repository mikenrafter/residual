use crate::nkp::matrix::NkpMatrix;

pub struct CriticalityReport {
    pub n: usize,
    pub k: usize,
    pub k_per_n: f64,
    pub assessment: String,
}

pub fn assess(matrix: &NkpMatrix) -> CriticalityReport {
    todo!("assess N/K balance and produce interpretation")
}
