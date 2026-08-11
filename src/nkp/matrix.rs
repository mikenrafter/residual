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
