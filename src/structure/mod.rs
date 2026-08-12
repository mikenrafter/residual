//! Structure — filter subsets (parallel architecture sets) and sort/group.
//! Default group key = attractor. Grouping stays flexible; not creation order.

use std::collections::BTreeMap;

pub mod analysis;
pub mod definition;

pub trait AttractorKeyed {
    fn attractor_id(&self) -> &str;
    fn record_id(&self) -> &str;
}

/// Group records by attractor id (sorted keys, not insertion/creation order).
pub fn group_by_attractor<T: AttractorKeyed + Clone>(
    items: &[T],
) -> BTreeMap<String, Vec<T>> {
    let mut map: BTreeMap<String, Vec<T>> = BTreeMap::new();
    for item in items {
        map.entry(item.attractor_id().to_string())
            .or_default()
            .push(item.clone());
    }
    map
}

/// Sort by attractor, then record id — never rely on creation order.
pub fn sort_by_attractor<T: AttractorKeyed>(items: &mut [T]) {
    items.sort_by(|a, b| {
        a.attractor_id()
            .cmp(b.attractor_id())
            .then_with(|| a.record_id().cmp(b.record_id()))
    });
}

/// Filter a parallel architecture set by name.
pub fn filter_architecture_set<'a, T>(
    items: &'a [T],
    set: &str,
    set_of: impl Fn(&T) -> &str,
) -> Vec<&'a T> {
    items.iter().filter(|i| set_of(i) == set).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct Rec {
        id: &'static str,
        attractor_id: &'static str,
    }

    impl AttractorKeyed for Rec {
        fn attractor_id(&self) -> &str {
            self.attractor_id
        }
        fn record_id(&self) -> &str {
            self.id
        }
    }

    #[test]
    fn structure_groups_by_attractor_as_external_api() {
        let records = vec![
            Rec {
                id: "P-02",
                attractor_id: "A-02",
            },
            Rec {
                id: "P-01",
                attractor_id: "A-01",
            },
            Rec {
                id: "S-01",
                attractor_id: "A-01",
            },
        ];
        let grouped = group_by_attractor(&records);
        let keys: Vec<&String> = grouped.keys().collect();
        assert_eq!(
            keys.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            vec!["A-01", "A-02"],
            "default group is attractor, sorted, not creation order"
        );
        assert_eq!(grouped["A-01"].len(), 2);
        assert_eq!(grouped["A-02"].len(), 1);

        let mut sorted = records.clone();
        sort_by_attractor(&mut sorted);
        assert_eq!(
            sorted.iter().map(|r| r.id).collect::<Vec<_>>(),
            vec!["P-01", "S-01", "P-02"]
        );
    }
}
