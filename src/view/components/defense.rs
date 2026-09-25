//! Defense-section rendering through nested Dioxus markup.

use dioxus::prelude::*;

use crate::view::snapshot::{DefenseSection, SnapshotAttractor, SnapshotMetaForce};

pub fn render_defense_records(defense: &DefenseSection) -> String {
    dioxus_ssr::render_element(rsx! {
        div { class: "defense-records",
            h3 { "Defense" }
            section { class: "defense-meta-forces",
                h4 { "Meta stressors" }
                ul {
                    for force in defense.meta_stressors.iter() {
                        {render_meta_force_item_element(force)}
                    }
                }
                h4 { "Meta purposes" }
                ul {
                    for force in defense.meta_purposes.iter() {
                        {render_meta_force_item_element(force)}
                    }
                }
            }
            section { class: "defense-meta-attractors",
                h4 { "Meta attractors" }
                ul {
                    for attractor in defense.meta_attractors.iter() {
                        {render_meta_attractor_item_element(attractor)}
                    }
                }
            }
            section { class: "defense-personas",
                h4 { "Personas" }
                ul {
                    for name in defense.personas.iter() {
                        li { class: "defense-record defense-persona", "persona · {name}" }
                    }
                }
            }
            section { class: "defense-strategies",
                h4 { "Strategies" }
                ul {
                    for name in defense.strategies.iter() {
                        li { class: "defense-record defense-strategy", "strategy · {name}" }
                    }
                }
            }
            section { class: "defense-progress",
                h4 { "Progress" }
                ul {
                    for name in defense.progress.iter() {
                        li { class: "defense-record defense-progress", "progress · {name}" }
                    }
                }
            }
            section { class: "defense-pitches",
                h4 { "Pitches" }
                ul {
                    for name in defense.pitches.iter() {
                        li { class: "defense-record defense-pitch", "pitch · {name}" }
                    }
                }
            }
        }
    })
}

fn render_meta_force_item_element(force: &SnapshotMetaForce) -> Element {
    rsx! {
        li {
            class: "defense-record defense-meta-force",
            "data-record-id": "{force.id}",
            "data-attractor-id": "{force.attractor_id}",
            "{force.id} · {force.shortname} — {force.description}"
        }
    }
}

fn render_meta_attractor_item_element(attractor: &SnapshotAttractor) -> Element {
    rsx! {
        li {
            class: "defense-record defense-meta-attractor",
            id: "defense-attractor-{attractor.id}",
            "data-record-id": "{attractor.id}",
            "{attractor.id} · {attractor.name} — {attractor.description}"
        }
    }
}

pub fn render_meta_force_item(force: &SnapshotMetaForce) -> String {
    dioxus_ssr::render_element(render_meta_force_item_element(force))
}

pub fn render_meta_attractor_item(attractor: &SnapshotAttractor) -> String {
    dioxus_ssr::render_element(render_meta_attractor_item_element(attractor))
}

pub fn render_defense_forms(_defense: &DefenseSection) -> String {
    // Presence of the defense section gates the forms; content is operator-staged.
    dioxus_ssr::render_element(rsx! {
        div { "data-modify-panel": "defense", hidden: true,
            div { class: "generators defense-generators",
                form { "data-command-generator": "meta-stressor",
                    fieldset {
                        legend { "meta-stressor" }
                        label { "description" }
                        input { name: "description", r#type: "text", required: "required" }
                        label { "shortname" }
                        input { name: "shortname", r#type: "text" }
                        button { r#type: "submit", "stage" }
                    }
                }
                form { "data-command-generator": "meta-attractor",
                    fieldset {
                        legend { "meta-attractor" }
                        label { "name" }
                        input { name: "name", r#type: "text", required: "required" }
                        label { "description" }
                        input { name: "description", r#type: "text", required: "required" }
                        label { "positive-state" }
                        input { name: "positive_state", r#type: "text", required: "required" }
                        label { "negative-state" }
                        input { name: "negative_state", r#type: "text", required: "required" }
                        button { r#type: "submit", "stage" }
                    }
                }
                form { "data-command-generator": "meta-purpose",
                    fieldset {
                        legend { "meta-purpose" }
                        label { "description" }
                        input { name: "description", r#type: "text", required: "required" }
                        label { "attractor-id" }
                        input { name: "attractor_id", r#type: "text", required: "required" }
                        label { "naive-change" }
                        input { name: "naive_change", r#type: "text", required: "required" }
                        label { "shortname" }
                        input { name: "shortname", r#type: "text" }
                        label { "outcomes" }
                        input { name: "outcomes", r#type: "text" }
                        button { r#type: "submit", "stage" }
                    }
                }
                form { "data-command-generator": "defense-persona",
                    fieldset {
                        legend { "defense-persona" }
                        label { "name" }
                        input { name: "name", r#type: "text", required: "required" }
                        label { "body" }
                        textarea { name: "body", required: "required" }
                        button { r#type: "submit", "stage" }
                    }
                }
                form { "data-command-generator": "defense-strategy",
                    fieldset {
                        legend { "defense-strategy" }
                        label { "name" }
                        input { name: "name", r#type: "text", required: "required" }
                        label { "body" }
                        textarea { name: "body", required: "required" }
                        button { r#type: "submit", "stage" }
                    }
                }
                form { "data-command-generator": "defense-progress",
                    fieldset {
                        legend { "defense-progress" }
                        label { "name" }
                        input { name: "name", r#type: "text", required: "required" }
                        label { "body" }
                        textarea { name: "body", required: "required" }
                        button { r#type: "submit", "stage" }
                    }
                }
                form { "data-command-generator": "defense-pitch",
                    fieldset {
                        legend { "defense-pitch" }
                        label { "name" }
                        input { name: "name", r#type: "text", required: "required" }
                        label { "body" }
                        textarea { name: "body", required: "required" }
                        button { r#type: "submit", "stage" }
                    }
                }
            }
        }
    })
}
