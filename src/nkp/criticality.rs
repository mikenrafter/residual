use crate::nkp::matrix::NkpMatrix;

pub struct CriticalityReport {
    pub n: usize,
    pub k: usize,
    pub k_per_n: f64,
    pub assessment: String,
}

pub fn assess(matrix: &NkpMatrix) -> CriticalityReport {
    let n = matrix.n();
    let k = matrix.k();
    let k_per_n = if n == 0 { 0.0 } else { k as f64 / n as f64 };

    let assessment = if k_per_n < 0.5 {
        "under-connected: K/N < 0.5, system has too few connections to exhibit robust emergent behavior".to_string()
    } else if k_per_n <= 3.0 {
        "critical: 0.5 ≤ K/N ≤ 3.0, system is in the zone of criticality (Kauffman K≈2)".to_string()
    } else {
        "over-connected: K/N > 3.0, system has too many connections and may be chaotic".to_string()
    };

    CriticalityReport { n, k, k_per_n, assessment }
}
