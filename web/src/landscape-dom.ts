// DOM helpers shared by the three landscape views (nkp-bundle, nkp-seriation,
// nkp-hypergraph): the attractor colour legend, the empty-state message, and
// zoom/pan inside the fixed-size landscape viewport. The viewport never
// scrolls; each view fits its drawing to it with a viewBox and lets the
// viewer zoom in instead.

export interface LegendEntry {
  id: string;
  label: string;
  color: string;
}

/** Appends a wrapping colour-key strip to `host` and returns it. */
export function renderLegend(host: HTMLElement, title: string, entries: readonly LegendEntry[], extras: readonly HTMLElement[] = []): HTMLElement {
  const legend = document.createElement("div");
  legend.className = "landscape-legend";
  const heading = document.createElement("span");
  heading.className = "landscape-legend-title";
  heading.textContent = title;
  legend.appendChild(heading);
  for (const entry of entries) {
    const item = document.createElement("span");
    item.className = "landscape-legend-item";
    item.dataset.legendId = entry.id;
    const swatch = document.createElement("i");
    swatch.style.background = entry.color;
    item.append(swatch, entry.label);
    legend.appendChild(item);
  }
  legend.append(...extras);
  host.appendChild(legend);
  return legend;
}

export function renderEmpty(host: HTMLElement, message: string): void {
  const empty = document.createElement("p");
  empty.className = "landscape-empty";
  empty.textContent = message;
  host.appendChild(empty);
}

/**
 * Appends an SVG that fills the rest of `host` (host is a flex column; any
 * legend sits above it) and scales `viewBox` to fit without scrolling.
 * Returns the svg selection and an inner group to draw into, which zoom and
 * pan transform. Ctrl/Cmd+wheel or pinch zooms so plain wheel still scrolls
 * the page; drag pans; double-click resets.
 */
export function appendZoomableSvg(
  host: HTMLElement,
  d3: any,
  viewBox: { x: number; y: number; width: number; height: number },
  className: string,
  label: string,
): { svg: any; content: any } {
  const svg = d3.select(host).append("svg")
    .attr("class", `landscape-svg ${className}`)
    .attr("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("role", "img")
    .attr("aria-label", label);
  const content = svg.append("g").attr("class", "landscape-zoom");
  const zoom = d3.zoom()
    .scaleExtent([0.5, 8])
    .filter((event: WheelEvent | MouseEvent) =>
      event.type === "wheel" ? (event as WheelEvent).ctrlKey || (event as WheelEvent).metaKey : !(event as MouseEvent).button)
    .on("zoom", (event: { transform: unknown }) => content.attr("transform", event.transform));
  svg.call(zoom).on("dblclick.zoom", null);
  svg.on("dblclick", () => svg.transition().duration(200).call(zoom.transform, d3.zoomIdentity));
  return { svg, content };
}

/**
 * Positions a tooltip element inside `host` near the pointer, kept within
 * the host's box so it never causes overflow.
 */
export function placeTooltip(host: HTMLElement, tip: HTMLElement, event: MouseEvent): void {
  tip.hidden = false;
  const bounds = host.getBoundingClientRect();
  const x = event.clientX - bounds.left + 14;
  const y = event.clientY - bounds.top + 14;
  const maxX = host.clientWidth - tip.offsetWidth - 6;
  const maxY = host.clientHeight - tip.offsetHeight - 6;
  tip.style.left = `${Math.max(4, Math.min(x, maxX))}px`;
  tip.style.top = `${Math.max(4, y > maxY ? y - tip.offsetHeight - 24 : y)}px`;
}

export function createTooltip(host: HTMLElement): HTMLElement {
  const tip = document.createElement("div");
  tip.className = "landscape-tip";
  tip.hidden = true;
  host.appendChild(tip);
  return tip;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}
