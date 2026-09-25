//! Static-export landscape rendering — replaces the old `html.rs` string
//! templating with Dioxus-rendered fragments spliced into the same template
//! shell (`shell.html`).

use anyhow::Result;

use crate::view::components::defense::{render_defense_forms, render_defense_records};
use crate::view::components::ledger::{render_modify_ledger_tabs, render_page_ledger_tabs};
use crate::view::components::matrix::render_matrix;
use crate::view::snapshot::LandscapeSnapshot;

pub(crate) const TEMPLATE: &str = include_str!("shell.html");

/// Token in [`TEMPLATE`] replaced by the serialized snapshot.
pub const SNAPSHOT_PLACEHOLDER: &str = "{{SNAPSHOT_JSON}}";

/// Element id of the `<script type="application/json">` block holding the snapshot.
pub const SNAPSHOT_ELEMENT_ID: &str = "residual-snapshot";

const MATRIX_PLACEHOLDER: &str = "{{MATRIX}}";
const DEFENSE_FORMS_PLACEHOLDER: &str = "{{DEFENSE_FORMS}}";
const DEFENSE_RECORDS_PLACEHOLDER: &str = "{{DEFENSE_RECORDS}}";
const PAGE_LEDGER_TABS_PLACEHOLDER: &str = "{{PAGE_LEDGER_TABS}}";
const IMPLEMENTATION_PANEL_OPEN_PLACEHOLDER: &str = "{{IMPLEMENTATION_PANEL_OPEN}}";
const IMPLEMENTATION_PANEL_CLOSE_PLACEHOLDER: &str = "{{IMPLEMENTATION_PANEL_CLOSE}}";
const DEFENSE_PANEL_PLACEHOLDER: &str = "{{DEFENSE_PANEL}}";
const MODIFY_LEDGER_TABS_PLACEHOLDER: &str = "{{MODIFY_LEDGER_TABS}}";
const IMPLEMENTATION_FORM_PANEL_OPEN_PLACEHOLDER: &str = "{{IMPLEMENTATION_FORM_PANEL_OPEN}}";
const IMPLEMENTATION_FORM_PANEL_CLOSE_PLACEHOLDER: &str = "{{IMPLEMENTATION_FORM_PANEL_CLOSE}}";

/// Token in [`TEMPLATE`] replaced by the compiled client-side bundle.
const APP_JS_PLACEHOLDER: &str = "{{APP_JS}}";

/// Compiled bundle of every `web/src/*.ts` module, rooted at `main.ts`.
/// Checked into the repo and regenerated via `scripts/gen-view-bundle.sh` —
/// NOT built during `cargo build`/crane's sandboxed derivation (no bun/
/// network guaranteed there). See
/// residual/iterations/view-live-editing-plan.md's "Locked decisions" table.
const APP_JS: &str = include_str!("../../web/generated/app.js");

/// Render the full landscape page for a snapshot.
pub fn render_landscape_html(snapshot: &LandscapeSnapshot) -> Result<String> {
    let json = escape_script_json(&snapshot.to_json()?);
    let matrix = render_matrix(snapshot);
    let defense_records = match &snapshot.defense {
        Some(defense) => render_defense_records(defense),
        None => String::new(),
    };
    let defense_forms = match &snapshot.defense {
        Some(defense) => render_defense_forms(defense),
        None => String::new(),
    };
    let has_defense = snapshot.defense.is_some();
    let page_ledger_tabs = has_defense
        .then(render_page_ledger_tabs)
        .unwrap_or_default();
    let implementation_panel_open = if has_defense {
        r#"<section id="implementation-ledger-panel" data-ledger-panel="implementation">"#
            .to_string()
    } else {
        String::new()
    };
    let implementation_panel_close = if has_defense { "</section>" } else { "" };
    let defense_panel = if has_defense {
        format!(
            r#"<section id="defense-ledger-panel" data-ledger-panel="defense" hidden>{defense_records}</section>"#
        )
    } else {
        String::new()
    };
    let modify_ledger_tabs = has_defense
        .then(render_modify_ledger_tabs)
        .unwrap_or_default();
    let implementation_form_panel_open = if has_defense {
        r#"<div data-modify-panel="implementation">"#.to_string()
    } else {
        String::new()
    };
    let implementation_form_panel_close = if has_defense { "</div>" } else { "" };

    let html = TEMPLATE
        .replace(SNAPSHOT_PLACEHOLDER, &json)
        .replace(MATRIX_PLACEHOLDER, &matrix)
        .replace(DEFENSE_RECORDS_PLACEHOLDER, "")
        .replace(DEFENSE_FORMS_PLACEHOLDER, &defense_forms)
        .replace(PAGE_LEDGER_TABS_PLACEHOLDER, &page_ledger_tabs)
        .replace(
            IMPLEMENTATION_PANEL_OPEN_PLACEHOLDER,
            &implementation_panel_open,
        )
        .replace(
            IMPLEMENTATION_PANEL_CLOSE_PLACEHOLDER,
            implementation_panel_close,
        )
        .replace(DEFENSE_PANEL_PLACEHOLDER, &defense_panel)
        .replace(MODIFY_LEDGER_TABS_PLACEHOLDER, &modify_ledger_tabs)
        .replace(
            IMPLEMENTATION_FORM_PANEL_OPEN_PLACEHOLDER,
            &implementation_form_panel_open,
        )
        .replace(
            IMPLEMENTATION_FORM_PANEL_CLOSE_PLACEHOLDER,
            implementation_form_panel_close,
        )
        .replace(APP_JS_PLACEHOLDER, APP_JS);
    Ok(html)
}

/// Extract the embedded snapshot JSON from rendered HTML (round-trip helper).
pub fn extract_snapshot_json(html: &str) -> Option<&str> {
    let open = r#"<script id="residual-snapshot" type="application/json">"#;
    let start = html.find(open)? + open.len();
    let end = html[start..].find("</script>")? + start;
    Some(&html[start..end])
}

/// Prevent ledger text from closing the embedding `<script>` block.
fn escape_script_json(json: &str) -> String {
    json.replace('<', "\\u003c")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::view::snapshot::{ForceKind, LandscapeSnapshot, RecordSource, SnapshotForce};
    use crate::view::testing::{fixture_defense_snapshot, fixture_main_snapshot};

    fn html(include_defense: bool) -> String {
        let snap = if include_defense {
            fixture_defense_snapshot()
        } else {
            fixture_main_snapshot()
        };
        render_landscape_html(&snap).expect("landscape html renders")
    }

    /// The page carries its own data — no fetch, no sidecar files at view time.
    #[test]
    fn html_embeds_snapshot_json_in_a_script_block() {
        let out = html(false);
        assert!(
            out.contains(r#"<script id="residual-snapshot" type="application/json">"#),
            "snapshot must be embedded as an application/json script block"
        );
        assert!(
            out.contains("S-01"),
            "embedded snapshot must carry force ids"
        );
        assert!(
            out.contains("queue-overload"),
            "shortnames must be embedded"
        );

        let json = extract_snapshot_json(&out).expect("snapshot json must be extractable");
        let parsed: LandscapeSnapshot = serde_json::from_str(json)
            .expect("embedded snapshot must be valid LandscapeSnapshot json");
        assert_eq!(parsed.stressors.len(), 1);
        assert_eq!(parsed.stressors[0].id, "S-01");
    }

    /// Force rows live inside the matrix table itself (no separate force
    /// list), addressable and filterable via the same data hooks as before.
    #[test]
    fn html_matrix_rows_carry_filterable_force_data() {
        let out = html(false);
        assert!(
            out.contains("data-force-filter"),
            "the toolbar filter input must be present"
        );
        assert!(
            out.contains(r#"data-force-id="S-01""#),
            "force rows must be addressable by force id"
        );
        assert!(
            out.contains(r#"data-force-kind="stressor""#),
            "force rows must expose kind for filtering"
        );
        assert!(
            out.contains(r#"data-architecture-set="iter1""#),
            "architecture_set must be exposed for filtering"
        );
        assert!(
            out.contains(r#"data-attractor-id="A-01""#),
            "force rows must expose their attractor id"
        );
    }

    /// Forces render as `S-<shortname>` / `P-<shortname>` accordion toggles,
    /// with full detail (description/naive-change/outcomes/attractor) folded
    /// into a hidden panel rather than a separate list outside the table.
    #[test]
    fn html_force_rows_are_accordions_labeled_by_shortname() {
        let out = html(false);
        assert!(
            out.contains(">S-queue-overload<"),
            "stressor label must be S-<shortname>, got: {out}"
        );
        assert!(
            out.contains(">P-landscape-view<"),
            "purpose label must be P-<shortname>"
        );
        assert!(
            out.contains("data-accordion-toggle"),
            "force label must be an accordion toggle"
        );
        assert!(
            out.contains(r#"class="force-detail" hidden"#),
            "force detail must be present but collapsed by default"
        );
        assert!(
            out.contains("queue overload")
                && out.contains("add retry")
                && out.contains("requests drain"),
            "force detail must carry description/naive_change/outcomes"
        );
    }

    /// Row totals (rightmost sticky column) and column totals (sticky
    /// footer) are computed from coupled residues.
    #[test]
    fn html_matrix_has_row_and_column_totals() {
        let out = html(false);
        assert!(
            out.contains(r#"data-row-total="1""#),
            "S-01 couples to exactly one component (auth), row total must be 1"
        );
        assert!(
            out.contains("<tfoot>"),
            "column totals must render as a sticky table footer"
        );
        assert!(
            out.contains(r#"data-col-total="1" data-component="auth""#),
            "auth column total must be 1"
        );
        assert!(
            out.contains(r#"data-col-total="0" data-component="db""#),
            "db column total must be 0 (no coupling)"
        );
        assert!(
            out.contains("data-grand-total"),
            "the bottom-right corner cell must carry the grand total"
        );
    }

    /// Sticky-positioning hooks: leftmost/rightmost columns and header/footer.
    #[test]
    fn html_matrix_carries_sticky_hooks() {
        let out = html(false);
        assert!(out.contains("sticky-col"), "leftmost column must be sticky");
        assert!(
            out.contains("sticky-col-right"),
            "rightmost column must be sticky"
        );
        assert!(out.contains("sticky-row"), "header row must be sticky");
        assert!(out.contains("<tfoot>"), "footer row exists to be sticky");
    }

    /// Column headers are click-sortable and carry component status metadata
    /// (styled distinctly, tooltip explains the stage) for every component,
    /// proposed included.
    #[test]
    fn html_matrix_headers_carry_sort_and_status_metadata() {
        let out = html(false);
        assert!(
            out.contains(r#"data-sort-key="force""#),
            "leftmost header must be sortable"
        );
        assert!(
            out.contains(r#"data-sort-key="component:auth""#),
            "component headers must be sortable"
        );
        assert!(
            out.contains(r#"data-sort-key="total""#),
            "totals header must be sortable"
        );
        assert!(
            out.contains(r#"data-status="actual""#),
            "component headers must expose raw status"
        );
        assert!(
            out.contains("status-dot status-actual"),
            "component status must be styled distinctly"
        );
        assert!(
            out.contains("title=\"actual — implemented and present in the codebase\""),
            "hovering a component header must explain its status via a tooltip"
        );
    }

    #[test]
    fn matrix_uses_shape_glyphs_for_component_status_and_force_kind() {
        let mut snap = fixture_main_snapshot();
        snap.components[1].status = "proposed".into();
        let out = render_landscape_html(&snap).expect("landscape html renders");
        assert!(
            out.contains(r#"data-component-status-shape="actual""#)
                && out.contains("status-shape-circle"),
            "actual component headers must carry a circle glyph"
        );
        assert!(
            out.contains(r#"data-component-status-shape="proposed""#)
                && out.contains("status-shape-square"),
            "proposed component headers must carry a square glyph"
        );
        assert!(
            out.contains(r#"data-force-kind-glyph="stressor""#),
            "stressor rows must carry a diamond glyph"
        );
        assert!(
            out.contains(r#"data-force-kind-glyph="purpose""#),
            "purpose rows must carry a circle glyph"
        );
    }

    #[test]
    fn matrix_force_rows_use_a_translucent_attractor_background() {
        let out = html(false);
        assert!(
            out.contains("force-attractor-tint")
                && out.contains("--force-attractor-color:")
                && out.contains("color-mix(in srgb, var(--force-attractor-color)"),
            "each force row must expose its attractor tint without using status color"
        );
    }

    /// Fusion/fission-only filter and live threshold slider markup hooks.
    /// Prior to Phase 8 this test also asserted the *inline* JS wiring
    /// (`computeMatrixCandidates`, `thresholdInput.addEventListener`) that
    /// used to live directly in `shell.html`. That inline script was deleted
    /// wholesale and replaced by the compiled `web/generated/app.js` bundle
    /// embedded via `APP_JS`/`APP_JS_PLACEHOLDER`; the same filter/sort/
    /// accordion-toggle/fusion-fission-threshold behavior is reimplemented in
    /// `web/src/matrix-view.ts` (restoring the regression, faithfully
    /// ported) and covered by `matrix-view.test.ts` via `bun test` against a
    /// real DOM — that's a better home for behavior assertions than grepping
    /// bundled JS text for function-name substrings, so only the still-true
    /// markup contract is asserted here.
    #[test]
    fn template_wires_live_fusion_fission_threshold() {
        assert!(
            TEMPLATE.contains("data-fusion-fission-filter"),
            "template must expose a fusion/fission-only filter control"
        );
        assert!(
            TEMPLATE.contains("data-threshold-input"),
            "template must expose a live threshold slider"
        );
    }

    /// End-to-end: rendered rows carry exactly the data the template's filter JS
    /// reads, so a filter matching kind/architecture_set actually has something to match.
    #[test]
    fn html_filter_js_and_rendered_rows_share_the_same_data_hooks() {
        let out = html(false);
        assert!(
            out.contains(r#"data-search="S-01 queue-overload stressor A-01 iter1""#),
            "rendered data-search must embed id, shortname, kind, attractor, and architecture_set for the JS filter to match on"
        );
    }

    /// Matrix / heatmap affordance backed by data attributes.
    #[test]
    fn html_contains_residue_matrix_with_cell_data_attributes() {
        let out = html(false);
        assert!(
            out.contains(r#"data-view="matrix""#),
            "matrix view is missing"
        );
        assert!(
            out.contains("data-residue-cell"),
            "matrix cells must be tagged data-residue-cell"
        );
        assert!(
            out.contains(r#"data-component="auth""#),
            "component columns must be addressable"
        );
        assert!(
            out.contains(r#"data-coupled="1""#),
            "the S-01 × auth coupling must render as a coupled cell"
        );
    }

    /// Staging forms + copy surface + the JS that builds commands.
    #[test]
    fn html_contains_command_generator_and_copy_surface() {
        let out = html(false);

        for target in ["stressor", "purpose", "attractor", "component"] {
            assert!(
                out.contains(&format!(r#"data-command-generator="{target}""#)),
                "missing staging form for {target}"
            );
        }
        assert!(
            out.contains("data-copy-commands"),
            "copy-commands surface is missing"
        );
        assert!(
            out.contains(r#"id="staged-commands""#),
            "staged command output element is missing"
        );
        // Command building (formerly the inline `buildAddCommand`/
        // `shellQuote` JS functions) now lives in the compiled
        // web/generated/app.js bundle (model.ts's `toCommandLines`), built
        // via `--flag` name/value pairs assembled at runtime rather than as
        // contiguous string literals in source — so individual `--flag`
        // substrings are no longer statically greppable in the rendered
        // output. The still-checkable, still-true invariant is that the
        // bundle's command-building vocabulary (`residual add `) is present.
        assert!(
            out.contains("residual add "),
            "generated commands must be `residual add …`"
        );
    }

    /// The UI is read-only against the ledger: it stages text, it does not write.
    #[test]
    fn html_command_generator_does_not_mutate_the_ledger() {
        let out = html(false);
        for forbidden in ["fetch(", "XMLHttpRequest", "navigator.sendBeacon"] {
            assert!(
                !out.contains(forbidden),
                "landscape UI must not call back into anything ({forbidden} found)"
            );
        }
    }

    /// Defense forms only exist in a defense landscape.
    #[test]
    fn html_omits_defense_forms_and_records_without_defense() {
        let out = html(false);
        for target in [
            "meta-stressor",
            "meta-attractor",
            "meta-purpose",
            "defense-persona",
            "defense-strategy",
            "defense-progress",
            "defense-pitch",
        ] {
            assert!(
                !out.contains(&format!(r#"data-command-generator="{target}""#)),
                "defense staging form for {target} must be absent without --defense"
            );
        }
        for needle in [
            "MS-01",
            "MA-01",
            "MP-01",
            "hostile-auditor",
            "alpha-strategy",
        ] {
            assert!(
                !out.contains(needle),
                "defense record {needle} leaked into a non-defense landscape"
            );
        }
    }

    #[test]
    fn html_includes_defense_forms_and_records_with_defense() {
        let out = html(true);
        for target in [
            "meta-stressor",
            "meta-attractor",
            "meta-purpose",
            "defense-persona",
            "defense-strategy",
            "defense-progress",
            "defense-pitch",
        ] {
            assert!(
                out.contains(&format!(r#"data-command-generator="{target}""#)),
                "defense staging form for {target} must be present with --defense"
            );
        }
        assert!(
            out.contains("MS-01"),
            "meta-stressor must render with --defense"
        );
        assert!(
            out.contains("MA-01"),
            "meta-attractor must render with --defense"
        );
        assert!(
            out.contains("MP-01"),
            "meta-purpose must render with --defense"
        );
        assert!(
            out.contains("hostile-auditor"),
            "defense persona must render with --defense"
        );
    }

    #[test]
    fn defense_flag_adds_one_page_level_ledger_switch_and_separate_panels() {
        let out = html(true);
        assert_eq!(
            out.matches("data-page-ledger-tabs").count(),
            1,
            "the implementation/defense page switch must appear once at page top"
        );
        for ledger in ["implementation", "defense"] {
            assert!(
                out.contains(&format!(r#"data-page-ledger-tab="{ledger}""#)),
                "missing {ledger} page tab"
            );
            assert!(
                out.contains(&format!(r#"data-ledger-panel="{ledger}""#)),
                "missing {ledger} page panel"
            );
            assert!(
                out.contains(&format!(r#"data-modify-ledger-switch="{ledger}""#)),
                "Modify must expose a synchronized {ledger} switch"
            );
            assert!(
                out.contains(&format!(r#"data-modify-panel="{ledger}""#)),
                "Modify forms must be separated into a {ledger} panel"
            );
        }

        let implementation = out
            .find(r#"data-ledger-panel="implementation""#)
            .expect("implementation panel");
        let defense = out
            .find(r#"data-ledger-panel="defense""#)
            .expect("defense panel");
        let tabs = out.find("data-page-ledger-tabs").expect("page ledger tabs");
        let toolbar = out.find("data-view-toolbar").expect("main toolbar");
        let matrix = out.find(r#"data-view="matrix""#).expect("matrix card");
        let landscape = out
            .find(r#"data-view="landscape""#)
            .expect("landscape card");
        let defense_record = out.find("MS-01").expect("defense record");
        assert!(
            tabs < implementation,
            "the ledger switch belongs at page top before its panels"
        );
        assert!(
            toolbar > implementation && toolbar < defense,
            "main toolbar belongs to implementation panel"
        );
        assert!(
            matrix > implementation && matrix < defense,
            "matrix belongs to implementation panel"
        );
        assert!(
            landscape > implementation && landscape < defense,
            "landscape belongs to implementation panel"
        );
        assert!(
            defense_record > defense,
            "defense records belong to defense panel"
        );

        let copy = out
            .find("data-copy-commands")
            .expect("shared copy/import surface");
        assert!(
            copy > out.find(r#"data-modify-panel="defense""#).unwrap(),
            "shared copy/import follows both form panels"
        );
    }

    #[test]
    fn default_page_has_no_implementation_defense_tab_markup() {
        let out = html(false);
        let markup = out
            .split("</style>")
            .nth(1)
            .expect("page body after embedded styles")
            .split(r#"<script type="module">"#)
            .next()
            .expect("page body markup before embedded application script");
        for marker in [
            "data-page-ledger-tabs",
            "data-page-ledger-tab",
            "data-ledger-panel",
            "data-modify-ledger-switch",
            "data-modify-panel",
        ] {
            assert!(
                !markup.contains(marker),
                "{marker} must be absent without --defense"
            );
        }
    }

    #[test]
    fn rust_page_and_defense_rendering_are_dioxus_components_without_unsafe_html_splicing() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let defense_source = std::fs::read_to_string(root.join("src/view/components/defense.rs"))
            .expect("defense component source");
        assert!(
            !defense_source.contains("dangerous_inner_html")
                && !defense_source.contains("push_str("),
            "defense records must render as nested Dioxus components"
        );

        let components_dir = root.join("src/view/components");
        let page_source = std::fs::read_dir(components_dir)
            .expect("view components directory")
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "rs"))
            .filter_map(|entry| std::fs::read_to_string(entry.path()).ok())
            .find(|source| source.contains("data-page-ledger-tabs"));
        let page_source =
            page_source.expect("the page/tab/panel structure must live in a Dioxus component");
        assert!(
            page_source.contains("rsx!"),
            "the page component must use Dioxus markup"
        );
        assert!(
            !page_source.contains("dangerous_inner_html"),
            "page rendering must not splice unsafe HTML"
        );
    }

    /// Ledger text must not be able to close the embedded script block.
    #[test]
    fn html_escapes_script_terminator_in_snapshot_values() {
        let mut snap = fixture_main_snapshot();
        snap.stressors = vec![SnapshotForce {
            id: "S-01".into(),
            shortname: "xss".into(),
            description: "</script><script>alert(1)</script>".into(),
            naive_change: "add retry".into(),
            outcomes: "drain".into(),
            attractor_id: "A-01".into(),
            kind: ForceKind::Stressor,
            source: RecordSource::Sidecar,
        }];

        let out = render_landscape_html(&snap).expect("landscape html renders");
        assert!(
            !out.contains("<script>alert(1)</script>"),
            "ledger text must not escape the embedded snapshot script block"
        );
    }

    /// The template asset carries the snapshot substitution hooks and the
    /// copy-commands surface; the app-bundle placeholder is asserted
    /// separately below. Since Phase 8, `buildAddCommand`/`shellQuote` no
    /// longer exist anywhere (superseded by model.ts's `toCommandLines`
    /// compiled into `APP_JS`), so those assertions were dropped rather than
    /// left to assert dead functions.
    #[test]
    fn template_asset_carries_placeholder_and_generator_js() {
        assert!(
            TEMPLATE.contains(SNAPSHOT_PLACEHOLDER),
            "template must contain the snapshot JSON substitution token"
        );
        assert!(
            TEMPLATE.contains(SNAPSHOT_ELEMENT_ID),
            "template must contain the snapshot script element id"
        );
        assert!(
            TEMPLATE.contains("data-copy-commands"),
            "template must define the copy-commands surface"
        );
    }

    /// The compiled client-side bundle (`web/generated/app.js`) is spliced
    /// into the rendered page as a `<script type="module">`, replacing the
    /// old inline `<script>` this phase deletes.
    #[test]
    fn template_and_html_embed_the_compiled_app_bundle() {
        assert!(
            TEMPLATE.contains(APP_JS_PLACEHOLDER),
            "template must contain the app-bundle substitution token"
        );
        assert!(
            !APP_JS.is_empty(),
            "the compiled app.js bundle must not be empty"
        );
        let out = html(false);
        assert!(
            out.contains(r#"<script type="module">"#),
            "rendered html must embed the compiled bundle as a module script"
        );
        assert!(
            !out.contains(APP_JS_PLACEHOLDER),
            "the {{APP_JS}} placeholder must be fully substituted in rendered output"
        );
    }
}
