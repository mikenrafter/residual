//! NKP matrix build + show (filter / sort / attractor grouping / separators).

use anyhow::Result;
use std::collections::{HashMap, HashSet};
use std::io::{self, Write};

use crate::cli::MatrixSortBy;
use crate::storage::stressors::Stressor;

pub struct NkpMatrix {
    pub stressor_ids: Vec<String>,
    /// Attractor id per force row (parallel to `stressor_ids`).
    pub attractor_ids: Vec<String>,
    pub components: Vec<String>,
    /// row-major: cells[stressor_idx][component_idx] = 0 or 1
    pub cells: Vec<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum EmitRow {
    /// Section banner (attractor group or fusion/fission annotation).
    Separator(String),
    /// Index into the matrix row arrays.
    Data(usize),
}

impl NkpMatrix {
    pub fn build(stressors: &[Stressor]) -> Self {
        let mut components: Vec<String> = Vec::new();
        for s in stressors {
            for comp in s.components_affected.split(',') {
                let comp = comp.trim().to_string();
                if !comp.is_empty() && !components.contains(&comp) {
                    components.push(comp);
                }
            }
        }

        let stressor_ids: Vec<String> = stressors.iter().map(|s| s.id.clone()).collect();
        let attractor_ids: Vec<String> = stressors.iter().map(|s| s.attractor_id.clone()).collect();

        let cells: Vec<Vec<u8>> = stressors
            .iter()
            .map(|s| {
                let affected: Vec<&str> =
                    s.components_affected.split(',').map(|c| c.trim()).collect();
                components
                    .iter()
                    .map(|comp| {
                        if affected.contains(&comp.as_str()) {
                            1
                        } else {
                            0
                        }
                    })
                    .collect()
            })
            .collect();

        NkpMatrix {
            stressor_ids,
            attractor_ids,
            components,
            cells,
        }
    }

    pub fn n(&self) -> usize {
        self.stressor_ids.len() + self.components.len()
    }

    pub fn k(&self) -> usize {
        self.cells
            .iter()
            .flat_map(|row| row.iter())
            .map(|&v| v as usize)
            .sum()
    }

    pub fn row_totals(&self) -> Vec<usize> {
        self.cells
            .iter()
            .map(|row| row.iter().map(|&v| v as usize).sum())
            .collect()
    }

    pub fn col_totals(&self) -> Vec<usize> {
        if self.components.is_empty() {
            return vec![];
        }
        let num_cols = self.components.len();
        let mut totals = vec![0usize; num_cols];
        for row in &self.cells {
            for (j, &v) in row.iter().enumerate() {
                totals[j] += v as usize;
            }
        }
        totals
    }

    pub fn hyperliminal_pairs(&self) -> Vec<(String, String)> {
        let num_cols = self.components.len();
        let mut pairs = Vec::new();
        for i in 0..num_cols {
            for j in (i + 1)..num_cols {
                let shared = self
                    .cells
                    .iter()
                    .filter(|row| row[i] == 1 && row[j] == 1)
                    .count();
                if shared >= 2 {
                    pairs.push((self.components[i].clone(), self.components[j].clone()));
                }
            }
        }
        pairs
    }

    pub fn fusion_candidates(&self) -> Vec<(String, String)> {
        let num_cols = self.components.len();
        let mut pairs = Vec::new();
        for i in 0..num_cols {
            for j in (i + 1)..num_cols {
                let identical = self.cells.iter().all(|row| row[i] == row[j]);
                if identical {
                    pairs.push((self.components[i].clone(), self.components[j].clone()));
                }
            }
        }
        pairs
    }

    pub fn fission_candidates(&self, threshold: usize) -> Vec<String> {
        let col_totals = self.col_totals();
        self.components
            .iter()
            .zip(col_totals.iter())
            .filter(|(_, &total)| total > threshold)
            .map(|(comp, _)| comp.clone())
            .collect()
    }

    /// Reorder component columns: fission (high col total) first, then fusion
    /// clusters, then remaining alphabetical.
    pub fn reorder_columns_fusion_fission(&mut self) {
        if self.components.is_empty() {
            return;
        }
        let col_totals = self.col_totals();
        let fusions = self.fusion_candidates();
        let threshold = (self.stressor_ids.len() / 2).max(1);
        let fission: HashSet<String> = self.fission_candidates(threshold).into_iter().collect();

        let mut parent: HashMap<String, String> = self
            .components
            .iter()
            .map(|c| (c.clone(), c.clone()))
            .collect();
        fn find(parent: &mut HashMap<String, String>, x: &str) -> String {
            let p = parent.get(x).cloned().unwrap_or_else(|| x.to_string());
            if p == x {
                return p;
            }
            let root = find(parent, &p);
            parent.insert(x.to_string(), root.clone());
            root
        }
        for (a, b) in &fusions {
            let ra = find(&mut parent, a);
            let rb = find(&mut parent, b);
            if ra != rb {
                parent.insert(ra, rb);
            }
        }

        let mut indexed: Vec<(usize, String, usize, String, bool)> = self
            .components
            .iter()
            .cloned()
            .enumerate()
            .map(|(i, c)| {
                let cluster = find(&mut parent, &c);
                let total = col_totals[i];
                let is_fission = fission.contains(&c);
                (i, c, total, cluster, is_fission)
            })
            .collect();
        indexed.sort_by(|a, b| {
            // fission first, then by descending col total, then fusion cluster, then name
            b.4.cmp(&a.4)
                .then_with(|| b.2.cmp(&a.2))
                .then_with(|| a.3.cmp(&b.3))
                .then_with(|| a.1.cmp(&b.1))
        });

        let new_order: Vec<usize> = indexed.iter().map(|(i, ..)| *i).collect();
        self.components = indexed.into_iter().map(|(_, c, ..)| c).collect();
        self.cells = self
            .cells
            .iter()
            .map(|row| new_order.iter().map(|&i| row[i]).collect())
            .collect();
    }

    fn row_label(&self, row_idx: usize, shortnames: &HashMap<String, String>) -> String {
        let id = &self.stressor_ids[row_idx];
        shortnames
            .get(id)
            .cloned()
            .unwrap_or_else(|| id.clone())
    }

    fn emit_plan(
        &self,
        sort_by: MatrixSortBy,
        attractor_names: &HashMap<String, String>,
    ) -> Vec<EmitRow> {
        let mut plan = Vec::new();
        let mut last_attractor = String::new();
        for idx in 0..self.stressor_ids.len() {
            let aid = &self.attractor_ids[idx];
            if aid != &last_attractor {
                let name = attractor_names
                    .get(aid)
                    .map(|n| format!(" · {n}"))
                    .unwrap_or_default();
                plan.push(EmitRow::Separator(format!("── {aid}{name} ──")));
                last_attractor = aid.clone();
            }
            plan.push(EmitRow::Data(idx));
        }

        // Fusion / fission annotation separators (always shown when present).
        let _ = sort_by; // fusion-fission already reordered columns before emit
        let fusions = self.fusion_candidates();
        let threshold = (self.stressor_ids.len() / 2).max(1);
        let fissions = self.fission_candidates(threshold);
        if !fusions.is_empty() || !fissions.is_empty() {
            plan.push(EmitRow::Separator("── fusion / fission ──".into()));
            for (a, b) in &fusions {
                plan.push(EmitRow::Separator(format!("── fusion: {a} ↔ {b} ──")));
            }
            for c in &fissions {
                plan.push(EmitRow::Separator(format!(
                    "── fission: {c} (col > {threshold}) ──"
                )));
            }
        }
        plan
    }

    pub fn print_colored(
        &self,
        shortnames: &HashMap<String, String>,
        attractor_names: &HashMap<String, String>,
        sort_by: MatrixSortBy,
    ) {
        use comfy_table::{Attribute, Cell, Color, Table};

        let row_totals = self.row_totals();
        let col_totals = self.col_totals();
        let grand = self.k();
        let max_row = row_totals.iter().copied().max().unwrap_or(0);
        let max_col = col_totals.iter().copied().max().unwrap_or(0);
        let plan = self.emit_plan(sort_by, attractor_names);

        let mut table = Table::new();
        table.enforce_styling();
        crossterm::style::force_color_output(true);

        let mut header = vec![Cell::new("").add_attribute(Attribute::Bold)];
        for comp in &self.components {
            header.push(Cell::new(comp).add_attribute(Attribute::Bold));
        }
        header.push(
            Cell::new("total")
                .add_attribute(Attribute::Bold)
                .fg(Color::Cyan),
        );
        table.set_header(header);

        for row in plan {
            match row {
                EmitRow::Separator(label) => {
                    let mut cells = vec![
                        Cell::new(&label)
                            .add_attribute(Attribute::Bold)
                            .fg(Color::Magenta),
                    ];
                    for _ in 0..self.components.len() {
                        cells.push(
                            Cell::new("─")
                                .fg(Color::DarkMagenta)
                                .bg(Color::Black),
                        );
                    }
                    cells.push(
                        Cell::new("─")
                            .fg(Color::DarkMagenta)
                            .bg(Color::Black),
                    );
                    table.add_row(cells);
                }
                EmitRow::Data(row_idx) => {
                    let mut cells = vec![Cell::new(self.row_label(row_idx, shortnames))];
                    for &val in &self.cells[row_idx] {
                        cells.push(coupling_heat_cell(val));
                    }
                    cells.push(total_heat_cell(row_totals[row_idx], max_row));
                    table.add_row(cells);
                }
            }
        }

        let mut totals_row = vec![
            Cell::new("total")
                .add_attribute(Attribute::Bold)
                .fg(Color::Cyan),
        ];
        for &t in &col_totals {
            totals_row.push(total_heat_cell(t, max_col));
        }
        totals_row.push(
            Cell::new(grand.to_string())
                .add_attribute(Attribute::Bold)
                .fg(Color::Black)
                .bg(Color::Cyan),
        );
        table.add_row(totals_row);

        println!("{table}");
    }

    pub fn print_csv(
        &self,
        shortnames: &HashMap<String, String>,
        attractor_names: &HashMap<String, String>,
        sort_by: MatrixSortBy,
    ) -> Result<()> {
        self.write_csv(io::stdout(), shortnames, attractor_names, sort_by)?;
        let _ = io::stdout().flush();
        Ok(())
    }

    pub fn write_csv<W: Write>(
        &self,
        writer: W,
        shortnames: &HashMap<String, String>,
        attractor_names: &HashMap<String, String>,
        sort_by: MatrixSortBy,
    ) -> Result<()> {
        let row_totals = self.row_totals();
        let col_totals = self.col_totals();
        let grand = self.k();
        let plan = self.emit_plan(sort_by, attractor_names);

        let mut wtr = csv::Writer::from_writer(writer);
        let mut header = vec![String::new()];
        header.extend(self.components.iter().cloned());
        header.push("total".to_string());
        wtr.write_record(&header)?;

        for row in plan {
            match row {
                EmitRow::Separator(label) => {
                    let mut rec = vec![label];
                    for _ in 0..self.components.len() {
                        rec.push(String::new());
                    }
                    rec.push(String::new());
                    wtr.write_record(&rec)?;
                }
                EmitRow::Data(row_idx) => {
                    let mut rec = Vec::with_capacity(2 + self.components.len());
                    rec.push(self.row_label(row_idx, shortnames));
                    for &val in &self.cells[row_idx] {
                        rec.push(val.to_string());
                    }
                    rec.push(row_totals[row_idx].to_string());
                    wtr.write_record(&rec)?;
                }
            }
        }

        let mut totals = Vec::with_capacity(2 + col_totals.len());
        totals.push("total".to_string());
        for &t in &col_totals {
            totals.push(t.to_string());
        }
        totals.push(grand.to_string());
        wtr.write_record(&totals)?;
        wtr.flush()?;
        Ok(())
    }
}

/// Filter stressors by attractor id, force id, or shortname (case-insensitive contains for shortname).
pub fn filter_stressors(
    stressors: &[Stressor],
    filters: &[String],
    shortnames: &HashMap<String, String>,
) -> Vec<Stressor> {
    if filters.is_empty() {
        return stressors.to_vec();
    }
    let needles: Vec<String> = filters
        .iter()
        .flat_map(|f| f.split(','))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if needles.is_empty() {
        return stressors.to_vec();
    }
    stressors
        .iter()
        .filter(|s| {
            needles.iter().any(|n| {
                let n_lower = n.to_lowercase();
                s.attractor_id.eq_ignore_ascii_case(n)
                    || s.id.eq_ignore_ascii_case(n)
                    || shortnames
                        .get(&s.id)
                        .map(|sn| sn.to_lowercase().contains(&n_lower))
                        .unwrap_or(false)
                    || s.description.to_lowercase().contains(&n_lower)
            })
        })
        .cloned()
        .collect()
}

/// Sort stressors for matrix show. Always stable within key; attractor grouping
/// sorts by attractor then secondary key.
pub fn sort_stressors(
    mut stressors: Vec<Stressor>,
    sort_by: MatrixSortBy,
    shortnames: &HashMap<String, String>,
) -> Vec<Stressor> {
    match sort_by {
        MatrixSortBy::Attractor | MatrixSortBy::FusionFission => {
            // Group by attractor; within group keep id order. Fusion-fission
            // additionally reorders columns after build.
            stressors.sort_by(|a, b| {
                a.attractor_id
                    .cmp(&b.attractor_id)
                    .then_with(|| a.id.cmp(&b.id))
            });
        }
        MatrixSortBy::Id => {
            stressors.sort_by(|a, b| a.id.cmp(&b.id));
        }
        MatrixSortBy::Alphabetical => {
            stressors.sort_by(|a, b| {
                let sa = shortnames
                    .get(&a.id)
                    .cloned()
                    .unwrap_or_else(|| a.id.clone());
                let sb = shortnames
                    .get(&b.id)
                    .cloned()
                    .unwrap_or_else(|| b.id.clone());
                sa.to_lowercase()
                    .cmp(&sb.to_lowercase())
                    .then_with(|| a.id.cmp(&b.id))
            });
        }
    }
    stressors
}

/// Binary coupling heatmap cell: background fill, not just green digit text.
fn coupling_heat_cell(val: u8) -> comfy_table::Cell {
    use comfy_table::{Cell, Color};
    if val == 1 {
        Cell::new("1").fg(Color::Black).bg(Color::Green)
    } else {
        Cell::new("0").fg(Color::DarkGrey).bg(Color::Black)
    }
}

/// Intensity heat for row/column totals relative to the max in that margin.
fn total_heat_cell(value: usize, max: usize) -> comfy_table::Cell {
    use comfy_table::{Attribute, Cell, Color};
    let cell = Cell::new(value.to_string()).add_attribute(Attribute::Bold);
    if max == 0 || value == 0 {
        return cell.fg(Color::DarkGrey).bg(Color::Black);
    }
    let t = value as f64 / max as f64;
    let r = (80.0 + t * 175.0) as u8;
    let g = (60.0 + t * 140.0) as u8;
    cell.fg(Color::Black).bg(Color::Rgb { r, g, b: 20 })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_stressor(id: &str, attractor: &str, components: &str) -> Stressor {
        Stressor {
            id: id.to_string(),
            description: "desc".to_string(),
            attractor_id: attractor.to_string(),
            naive_change: "change".to_string(),
            outcomes: "system handles auth".to_string(),
            components_affected: components.to_string(),
        }
    }

    fn two_by_three() -> Vec<Stressor> {
        vec![
            make_stressor("S-01", "A-01", "auth,db"),
            make_stressor("S-02", "A-02", "db,cache"),
        ]
    }

    #[test]
    fn build_correct_cells() {
        let stressors = two_by_three();
        let m = NkpMatrix::build(&stressors);
        let auth_idx = m.components.iter().position(|c| c == "auth").unwrap();
        let db_idx = m.components.iter().position(|c| c == "db").unwrap();
        let cache_idx = m.components.iter().position(|c| c == "cache").unwrap();
        assert_eq!(m.cells[0][auth_idx], 1);
        assert_eq!(m.cells[1][auth_idx], 0);
        assert_eq!(m.cells[0][db_idx], 1);
        assert_eq!(m.cells[1][db_idx], 1);
        assert_eq!(m.cells[0][cache_idx], 0);
        assert_eq!(m.cells[1][cache_idx], 1);
        assert_eq!(m.attractor_ids, vec!["A-01", "A-02"]);
    }

    #[test]
    fn n_equals_stressors_plus_components() {
        let m = NkpMatrix::build(&two_by_three());
        assert_eq!(m.n(), 5);
    }

    #[test]
    fn k_equals_count_of_ones() {
        let m = NkpMatrix::build(&two_by_three());
        assert_eq!(m.k(), 4);
    }

    #[test]
    fn row_totals() {
        let m = NkpMatrix::build(&two_by_three());
        let rt = m.row_totals();
        assert_eq!(rt, vec![2, 2]);
    }

    #[test]
    fn col_totals() {
        let m = NkpMatrix::build(&two_by_three());
        let ct = m.col_totals();
        let db_idx = m.components.iter().position(|c| c == "db").unwrap();
        assert_eq!(ct[db_idx], 2);
    }

    #[test]
    fn hyperliminal_pairs_finds_shared_stressors() {
        let stressors = vec![
            make_stressor("S-01", "A-01", "auth,db"),
            make_stressor("S-02", "A-01", "auth,db"),
            make_stressor("S-03", "A-01", "auth,db"),
        ];
        let m = NkpMatrix::build(&stressors);
        assert!(!m.hyperliminal_pairs().is_empty());
    }

    #[test]
    fn hyperliminal_pairs_empty_when_no_shared() {
        let stressors = vec![
            make_stressor("S-01", "A-01", "auth"),
            make_stressor("S-02", "A-01", "db"),
        ];
        let m = NkpMatrix::build(&stressors);
        assert!(m.hyperliminal_pairs().is_empty());
    }

    #[test]
    fn fusion_candidates_identical_column_vectors() {
        let stressors = vec![
            make_stressor("S-01", "A-01", "auth,twin"),
            make_stressor("S-02", "A-01", "auth,twin"),
        ];
        let m = NkpMatrix::build(&stressors);
        let fusions = m.fusion_candidates();
        assert!(fusions.iter().any(|(a, b)| {
            (a == "auth" && b == "twin") || (a == "twin" && b == "auth")
        }));
    }

    #[test]
    fn fission_candidates_above_threshold() {
        let stressors = vec![
            make_stressor("S-01", "A-01", "db"),
            make_stressor("S-02", "A-01", "db"),
            make_stressor("S-03", "A-01", "db"),
        ];
        let m = NkpMatrix::build(&stressors);
        assert!(m.fission_candidates(2).contains(&"db".to_string()));
    }

    #[test]
    fn filter_by_attractor_id() {
        let out = filter_stressors(&two_by_three(), &["A-02".into()], &HashMap::new());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "S-02");
    }

    #[test]
    fn sort_by_attractor_groups() {
        let stressors = vec![
            make_stressor("S-02", "A-02", "db"),
            make_stressor("S-01", "A-01", "auth"),
            make_stressor("S-03", "A-01", "cache"),
        ];
        let sorted = sort_stressors(stressors, MatrixSortBy::Attractor, &HashMap::new());
        assert_eq!(
            sorted.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            vec!["S-01", "S-03", "S-02"]
        );
    }

    #[test]
    fn sort_alphabetical_by_shortname() {
        let stressors = two_by_three();
        let mut sn = HashMap::new();
        sn.insert("S-01".into(), "zeta".into());
        sn.insert("S-02".into(), "alpha".into());
        let sorted = sort_stressors(stressors, MatrixSortBy::Alphabetical, &sn);
        assert_eq!(sorted[0].id, "S-02");
        assert_eq!(sorted[1].id, "S-01");
    }

    #[test]
    fn csv_includes_attractor_separators_and_totals() {
        let stressors = sort_stressors(two_by_three(), MatrixSortBy::Attractor, &HashMap::new());
        let m = NkpMatrix::build(&stressors);
        let mut names = HashMap::new();
        names.insert("A-01".into(), "Clarity".into());
        names.insert("A-02".into(), "Drift".into());
        let mut buf = Vec::new();
        m.write_csv(&mut buf, &HashMap::new(), &names, MatrixSortBy::Attractor)
            .unwrap();
        let csv = String::from_utf8(buf).unwrap();
        assert!(csv.contains("── A-01 · Clarity ──"), "csv={csv}");
        assert!(csv.contains("── A-02 · Drift ──"), "csv={csv}");
        assert!(csv.lines().any(|l| l.starts_with("total,")), "csv={csv}");
    }

    #[test]
    fn csv_includes_row_and_column_totals() {
        let m = NkpMatrix::build(&two_by_three());
        let mut buf = Vec::new();
        m.write_csv(
            &mut buf,
            &HashMap::new(),
            &HashMap::new(),
            MatrixSortBy::Id,
        )
        .unwrap();
        let csv = String::from_utf8(buf).unwrap();
        let lines: Vec<&str> = csv.lines().collect();
        assert!(lines[0].ends_with(",total"), "header={}", lines[0]);
        let totals = *lines.last().unwrap();
        assert!(
            totals == "total,1,2,1,4",
            "col totals + grand: {totals}"
        );
    }

    #[test]
    fn csv_uses_force_shortnames_as_row_labels() {
        let m = NkpMatrix::build(&two_by_three());
        let mut shortnames = HashMap::new();
        shortnames.insert("S-01".into(), "skill-version-drift".into());
        shortnames.insert("S-02".into(), "lexicon-scale-lag".into());
        let mut buf = Vec::new();
        m.write_csv(
            &mut buf,
            &shortnames,
            &HashMap::new(),
            MatrixSortBy::Id,
        )
        .unwrap();
        let csv = String::from_utf8(buf).unwrap();
        assert!(csv.contains("skill-version-drift"), "csv={csv}");
        assert!(csv.contains("lexicon-scale-lag"), "csv={csv}");
    }
}
