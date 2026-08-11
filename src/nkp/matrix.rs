use anyhow::Result;
use crate::storage::stressors::Stressor;

pub struct NkpMatrix {
    pub stressor_ids: Vec<String>,
    pub components: Vec<String>,
    /// row-major: cells[stressor_idx][component_idx] = 0 or 1
    pub cells: Vec<Vec<u8>>,
}

impl NkpMatrix {
    pub fn build(stressors: &[Stressor]) -> Self {
        todo!("build matrix from stressors")
    }

    pub fn n(&self) -> usize {
        todo!("total nodes = stressors + components")
    }

    pub fn k(&self) -> usize {
        todo!("total 1s in matrix")
    }

    pub fn row_totals(&self) -> Vec<usize> {
        todo!("sum each row")
    }

    pub fn col_totals(&self) -> Vec<usize> {
        todo!("sum each column")
    }

    pub fn hyperliminal_pairs(&self) -> Vec<(String, String)> {
        todo!("find component pairs sharing ≥2 stressor rows")
    }

    pub fn print_colored(&self) {
        todo!("render with comfy-table + owo-colors")
    }

    pub fn fusion_candidates(&self) -> Vec<(String, String)> {
        todo!("components with identical stress-response patterns")
    }

    pub fn fission_candidates(&self, threshold: usize) -> Vec<String> {
        todo!("components with col total > threshold")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::stressors::Stressor;

    fn make_stressor(id: &str, components: &str) -> Stressor {
        Stressor {
            id: id.to_string(),
            description: "desc".to_string(),
            attractor_id: "A-01".to_string(),
            naive_change: "change".to_string(),
            traits: "system handles auth".to_string(),
            components_affected: components.to_string(),
        }
    }

    /// 2 stressors, 3 unique components: auth, db, cache
    /// S-01 affects auth,db
    /// S-02 affects db,cache
    fn two_by_three() -> Vec<Stressor> {
        vec![
            make_stressor("S-01", "auth,db"),
            make_stressor("S-02", "db,cache"),
        ]
    }

    #[test]
    fn build_correct_cells() {
        let stressors = two_by_three();
        let m = NkpMatrix::build(&stressors);
        // auth: row0=1, row1=0
        let auth_idx = m.components.iter().position(|c| c == "auth").unwrap();
        let db_idx   = m.components.iter().position(|c| c == "db").unwrap();
        let cache_idx = m.components.iter().position(|c| c == "cache").unwrap();
        assert_eq!(m.cells[0][auth_idx], 1);
        assert_eq!(m.cells[1][auth_idx], 0);
        assert_eq!(m.cells[0][db_idx], 1);
        assert_eq!(m.cells[1][db_idx], 1);
        assert_eq!(m.cells[0][cache_idx], 0);
        assert_eq!(m.cells[1][cache_idx], 1);
    }

    #[test]
    fn n_equals_stressors_plus_components() {
        let m = NkpMatrix::build(&two_by_three());
        // 2 stressors + 3 components = 5
        assert_eq!(m.n(), 5);
    }

    #[test]
    fn k_equals_count_of_ones() {
        let m = NkpMatrix::build(&two_by_three());
        // S-01: auth+db=2, S-02: db+cache=2 → total 4
        assert_eq!(m.k(), 4);
    }

    #[test]
    fn row_totals() {
        let m = NkpMatrix::build(&two_by_three());
        let rt = m.row_totals();
        assert_eq!(rt.len(), 2);
        assert_eq!(rt[0], 2); // S-01 hits auth,db
        assert_eq!(rt[1], 2); // S-02 hits db,cache
    }

    #[test]
    fn col_totals() {
        let m = NkpMatrix::build(&two_by_three());
        let ct = m.col_totals();
        let db_idx = m.components.iter().position(|c| c == "db").unwrap();
        assert_eq!(ct[db_idx], 2); // db hit by both stressors
    }

    #[test]
    fn hyperliminal_pairs_finds_shared_stressors() {
        // S-01 and S-02 both affect db — but we need ≥2 shared stressors
        // Use 3 stressors all affecting same two components
        let stressors = vec![
            make_stressor("S-01", "auth,db"),
            make_stressor("S-02", "auth,db"),
            make_stressor("S-03", "auth,db"),
        ];
        let m = NkpMatrix::build(&stressors);
        let pairs = m.hyperliminal_pairs();
        assert!(!pairs.is_empty(), "should find auth-db as hyperliminal pair");
    }

    #[test]
    fn hyperliminal_pairs_empty_when_no_shared() {
        let stressors = vec![
            make_stressor("S-01", "auth"),
            make_stressor("S-02", "db"),
        ];
        let m = NkpMatrix::build(&stressors);
        let pairs = m.hyperliminal_pairs();
        assert!(pairs.is_empty());
    }

    #[test]
    fn fusion_candidates_identical_column_vectors() {
        // auth and cache have identical column vectors: [1,0] and [0,1] - different
        // Make them identical: both hit by S-01 and S-02 only
        let stressors = vec![
            make_stressor("S-01", "auth,twin"),
            make_stressor("S-02", "auth,twin"),
        ];
        let m = NkpMatrix::build(&stressors);
        let fusions = m.fusion_candidates();
        assert!(!fusions.is_empty(), "auth and twin have identical vectors");
        let found = fusions.iter().any(|(a, b)| {
            (a == "auth" && b == "twin") || (a == "twin" && b == "auth")
        });
        assert!(found);
    }

    #[test]
    fn fission_candidates_above_threshold() {
        let stressors = vec![
            make_stressor("S-01", "db"),
            make_stressor("S-02", "db"),
            make_stressor("S-03", "db"),
        ];
        let m = NkpMatrix::build(&stressors);
        // db col total = 3; threshold 2 → db is a fission candidate
        let fissions = m.fission_candidates(2);
        assert!(fissions.contains(&"db".to_string()));
    }
}
