/// Residual Index: Ri = (Y - X) / S
/// X = stressors survived by naïve architecture
/// Y = stressors survived by residual architecture
/// S = total test stressors
/// Valid range: -1 < Ri < 1
pub fn calculate(naive_survived: usize, residual_survived: usize, total: usize) -> f64 {
    (residual_survived as f64 - naive_survived as f64) / total as f64
}

pub fn interpret(ri: f64) -> &'static str {
    if ri > 0.0 {
        "Positive improvement: the residual architecture survived more stressors than the naïve baseline."
    } else if ri == 0.0 {
        "No improvement (zero): the residual architecture performed identically to the naïve baseline."
    } else {
        "Negative regression: the residual architecture survived fewer stressors than the naïve baseline."
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calculate_positive() {
        // (5 - 0) / 10 = 0.5
        let ri = calculate(0, 5, 10);
        assert!((ri - 0.5).abs() < 1e-9, "expected 0.5, got {}", ri);
    }

    #[test]
    fn calculate_zero() {
        // (3 - 3) / 10 = 0.0
        let ri = calculate(3, 3, 10);
        assert!((ri - 0.0).abs() < 1e-9, "expected 0.0, got {}", ri);
    }

    #[test]
    fn calculate_negative() {
        // (2 - 5) / 10 = -0.3
        let ri = calculate(5, 2, 10);
        assert!((ri - (-0.3)).abs() < 1e-9, "expected -0.3, got {}", ri);
    }

    #[test]
    fn interpret_positive_contains_positive() {
        let msg = interpret(0.5);
        assert!(
            msg.to_lowercase().contains("positive"),
            "expected 'positive' in {:?}",
            msg
        );
    }

    #[test]
    fn interpret_zero_contains_no_improvement_or_zero() {
        let msg = interpret(0.0);
        let lower = msg.to_lowercase();
        assert!(
            lower.contains("no improvement") || lower.contains("zero"),
            "expected 'no improvement' or 'zero' in {:?}",
            msg
        );
    }

    #[test]
    fn interpret_negative_contains_negative_or_regression() {
        let msg = interpret(-0.3);
        let lower = msg.to_lowercase();
        assert!(
            lower.contains("negative") || lower.contains("regression"),
            "expected 'negative' or 'regression' in {:?}",
            msg
        );
    }
}
