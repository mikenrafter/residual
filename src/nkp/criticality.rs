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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::stressors::Stressor;
    use crate::nkp::matrix::NkpMatrix;

    fn make_stressor(id: &str, components: &str) -> Stressor {
        Stressor {
            id: id.to_string(),
            shortname: String::new(),
            description: "d".to_string(),
            attractor_id: "A-01".to_string(),
            naive_change: "c".to_string(),
            outcomes: "system handles auth".to_string(),
            components_affected: components.to_string(),
        }
    }

    #[test]
    fn assess_empty_matrix_is_undercritical() {
        let m = NkpMatrix::build(&[]);
        let r = assess(&m);
        assert_eq!(r.k_per_n, 0.0);
        assert!(r.assessment.contains("under-connected"), "empty matrix should be under-connected");
    }

    #[test]
    fn assess_critical_zone() {
        // 2 stressors × 2 components: N=4, K=4, K/N=1.0 → critical
        let s = vec![
            make_stressor("S-01", "auth,db"),
            make_stressor("S-02", "auth,db"),
        ];
        let m = NkpMatrix::build(&s);
        let r = assess(&m);
        assert!(r.k_per_n >= 0.5 && r.k_per_n <= 3.0, "K/N={} should be in critical zone", r.k_per_n);
        assert!(r.assessment.contains("critical"), "expected 'critical' in assessment");
    }

    #[test]
    fn assess_overcritical() {
        // 4 stressors each hitting same component: N=5, K=4, K/N=0.8 — still critical.
        // To get K/N > 3.0: need many stressors hitting few components.
        // 4 stressors × 1 component each, but all the same: N = 4+1 = 5, K = 4, K/N = 0.8
        // Let's use 1 stressor hitting 4 components: N=5, K=4, K/N=0.8 — still critical
        // Use 3 stressors each hitting 4 components = N=7, K=12, K/N≈1.7 — critical
        // For K/N > 3: 1 stressor, 4 components it hits all 4 → N=5, K=4, still 0.8
        // Easier: many stressors, few components.
        // 10 stressors all hitting same 1 component: N=10+1=11, K=10, K/N=0.9 — critical!
        // To exceed K/N=3: K > 3N. If N=2 (1 stressor, 1 component), K=1, K/N=0.5
        // If 2 components, 1 stressor hits both: N=3, K=2, K/N=0.67
        // Tight: N stressors, 1 component each row.
        // Let 4 stressors hit 1 component = N=5, K=4, K/N=0.8
        // For over-critical: need K/N > 3. Very dense matrix.
        // 3 stressors × 3 components all = 1: N=6, K=9, K/N=1.5 — critical
        // 3 stressors × 5 components all = 1: N=8, K=15, K/N=1.875 — critical
        // 3 stressors × 10 components all = 1: N=13, K=30, K/N=2.3 — critical
        // 3 stressors × 20 components all = 1: N=23, K=60, K/N=2.6 — critical
        // Hard with just components. Use 2 stressors × 10 components: N=12, K=20, K/N=1.67
        // For K/N > 3.0 with small N:
        // N=4 (2 stressors + 2 components), K=4, K/N=1.0. Not enough.
        // Actually for K/N > 3 we need K > 3N.
        // Say we have 1 stressor row + 1 component col: N=2, K=1, K/N=0.5
        // 2 stressor rows + 1 component col: N=3, K=2, K/N=0.67
        // We need K=3*N+1. With N=2: K=7 — impossible (max K = rows*cols = 1*2=2)
        // This reveals K/N > 3.0 may be unreachable with the current matrix definition
        // where N = stressor_count + component_count and K = cell_count of 1s.
        // Max K = stressors × components. N = stressors + components.
        // K/N = (s*c)/(s+c). Max at s=c: (s^2)/(2s) = s/2.
        // For K/N > 3 → s/2 > 3 → s > 6, with all cells = 1.
        // Let s=8, c=8: K/N = 64/16 = 4.0 > 3.0 ✓
        let comps = (0..8).map(|i| format!("c{}", i)).collect::<Vec<_>>().join(",");
        let s: Vec<Stressor> = (0..8).map(|i| make_stressor(&format!("S-{:02}", i+1), &comps)).collect();
        let m = NkpMatrix::build(&s);
        let r = assess(&m);
        assert!(r.k_per_n > 3.0, "K/N={} should exceed 3.0 for 8x8 full matrix", r.k_per_n);
        assert!(r.assessment.contains("over-connected"), "expected 'over-connected' assessment");
    }

    #[test]
    fn assess_undercritical_single_stressor_no_components() {
        // A stressor with no components: N=1+0=1, K=0, K/N=0 → under-connected
        let s = vec![make_stressor("S-01", "")];
        let m = NkpMatrix::build(&s);
        let r = assess(&m);
        assert!(r.k_per_n < 0.5, "expected under-connected, K/N={}", r.k_per_n);
        assert!(r.assessment.contains("under-connected"));
    }
}
