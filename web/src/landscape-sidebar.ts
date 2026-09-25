// Renders the cross-view selection sidebar: a header (count + deselect-all)
// followed by one card per selected entity, each showing every field the
// view tooltips already show plus a per-card deselect control. Pure DOM
// rendering — the caller (nkp-landscape.ts) owns the selection Set and
// passes the resolved `EntityDetail[]` in on every change.

import type { EntityDetail, EntityKey } from "./landscape-selection";

export interface SidebarHandlers {
  onDeselect: (key: EntityKey) => void;
  onClearAll: () => void;
}

/** Replaces `el`'s contents with the sidebar header and one card per detail. */
export function renderSidebar(el: HTMLElement, details: EntityDetail[], handlers: SidebarHandlers): void {
  el.replaceChildren();

  const header = document.createElement("div");
  header.className = "landscape-sidebar-header";
  const count = document.createElement("span");
  count.className = "landscape-sidebar-count";
  count.textContent = `${details.length} selected`;
  const clearAll = document.createElement("button");
  clearAll.type = "button";
  clearAll.className = "landscape-sidebar-clear";
  clearAll.dataset.landscapeDeselectAll = "";
  clearAll.textContent = "deselect all";
  clearAll.addEventListener("click", () => handlers.onClearAll());
  header.append(count, clearAll);
  el.appendChild(header);

  if (details.length === 0) {
    const empty = document.createElement("p");
    empty.className = "landscape-sidebar-empty";
    empty.dataset.sidebarEmpty = "";
    empty.textContent = "Click a component, force or attractor in the landscape to see its details here.";
    el.appendChild(empty);
    return;
  }

  for (const detail of details) {
    const card = document.createElement("article");
    card.className = "landscape-sidebar-card";
    card.dataset.sidebarCard = "";
    card.dataset.key = detail.key;

    const cardHeader = document.createElement("div");
    cardHeader.className = "landscape-sidebar-card-header";
    if (detail.color) {
      const chip = document.createElement("i");
      chip.className = "landscape-sidebar-chip";
      chip.style.background = detail.color;
      cardHeader.appendChild(chip);
    }
    const kind = document.createElement("span");
    kind.className = "landscape-sidebar-kind";
    kind.textContent = detail.kind;
    const title = document.createElement("strong");
    title.className = "landscape-sidebar-title";
    title.textContent = detail.title;
    const deselect = document.createElement("button");
    deselect.type = "button";
    deselect.className = "landscape-sidebar-deselect";
    deselect.dataset.sidebarDeselect = "";
    deselect.setAttribute("aria-label", `Deselect ${detail.title}`);
    deselect.textContent = "×";
    deselect.addEventListener("click", () => handlers.onDeselect(detail.key));
    cardHeader.append(kind, title, deselect);
    card.appendChild(cardHeader);

    const fields = document.createElement("dl");
    fields.className = "landscape-sidebar-fields";
    for (const field of detail.fields) {
      const dt = document.createElement("dt");
      dt.textContent = field.label;
      const dd = document.createElement("dd");
      dd.textContent = field.value;
      fields.append(dt, dd);
    }
    card.appendChild(fields);
    el.appendChild(card);
  }
}
