/// Residual Index: Ri = (Y - X) / S
/// X = stressors survived by naïve architecture
/// Y = stressors survived by residual architecture
/// S = total test stressors
/// Valid range: -1 < Ri < 1
pub fn calculate(naive_survived: usize, residual_survived: usize, total: usize) -> f64 {
    todo!("compute Ri")
}

pub fn interpret(ri: f64) -> &'static str {
    todo!("textual interpretation of Ri value")
}
