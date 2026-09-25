import { attractorColorForId } from "./nkp-graph";

export type MatrixForceKind = "stressor" | "purpose";

/** Applies the same shape and attractor-color semantics to client-inserted rows. */
export function decorateForceRow(row: HTMLTableRowElement, kind: MatrixForceKind, attractorId: string): void {
  row.classList.add("force-attractor-tint");
  row.setAttribute("data-force-kind", kind);
  row.setAttribute("data-force-kind-glyph", kind);
  row.setAttribute("data-attractor-id", attractorId);
  row.setAttribute("data-force-attractor-tint", "true");
  row.style.setProperty("--force-attractor-color", attractorColorForId(attractorId));

  const label = row.querySelector<HTMLElement>(".force-accordion-toggle") ?? row.querySelector<HTMLElement>("th.sticky-col");
  if (label === null) return;
  label.setAttribute("data-force-kind-glyph", kind);

  let glyph = label.querySelector<HTMLElement>(".force-kind-glyph");
  if (glyph === null) {
    glyph = document.createElement("span");
    glyph.className = "force-kind-glyph";
    glyph.setAttribute("aria-hidden", "true");
    const detail = label.querySelector(".force-detail");
    label.insertBefore(glyph, detail);
  }
  glyph.className = `force-kind-glyph force-kind-${kind}`;
}

/** Adds an accessible status shape to a component header without status colors. */
export function decorateComponentHeader(header: HTMLTableCellElement, status: string): void {
  const shape = status === "actual" ? "circle" : status === "proposed" ? "square" : "other";
  header.setAttribute("data-status", status);
  header.setAttribute("data-component-status-shape", status);

  let glyph = header.querySelector<HTMLElement>(".component-status-glyph");
  if (glyph === null) {
    glyph = document.createElement("span");
    glyph.setAttribute("aria-hidden", "true");
    header.prepend(glyph);
  }
  glyph.className = `component-status-glyph status-shape-${shape}`;
}
