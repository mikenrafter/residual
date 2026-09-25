//! Dioxus-rendered switches for the optional implementation/defense ledgers.

use dioxus::prelude::*;

/// Render the single page-level switch shown when the defense ledger exists.
pub fn render_page_ledger_tabs() -> String {
    dioxus_ssr::render_element(rsx! {
        nav {
            class: "ledger-tabs",
            "data-page-ledger-tabs": "",
            role: "tablist",
            "aria-label": "Ledger",
            button {
                r#type: "button",
                "data-page-ledger-tab": "implementation",
                role: "tab",
                "aria-selected": "true",
                "aria-controls": "implementation-ledger-panel",
                "Implementation"
            }
            button {
                r#type: "button",
                "data-page-ledger-tab": "defense",
                role: "tab",
                "aria-selected": "false",
                "aria-controls": "defense-ledger-panel",
                "Defense"
            }
        }
    })
}

/// Render the synchronized switch inside Modify.
pub fn render_modify_ledger_tabs() -> String {
    dioxus_ssr::render_element(rsx! {
        nav {
            class: "ledger-tabs modify-ledger-tabs",
            role: "tablist",
            "aria-label": "Modify ledger",
            button {
                r#type: "button",
                "data-modify-ledger-switch": "implementation",
                role: "tab",
                "aria-selected": "true",
                "Implementation"
            }
            button {
                r#type: "button",
                "data-modify-ledger-switch": "defense",
                role: "tab",
                "aria-selected": "false",
                "Defense"
            }
        }
    })
}
