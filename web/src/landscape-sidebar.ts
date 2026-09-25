// Renders the cross-view detail card. The caller owns the additive selection
// and passes the active key separately, so navigation changes the focused
// detail without changing which entities are selected.

import type { EntityDetail, EntityKey } from "./landscape-selection";

export interface SidebarHandlers {
  activeKey?: EntityKey;
  onActivate: (key: EntityKey) => void;
  onDeselect: (key: EntityKey) => void;
  onClearAll: () => void;
}

/** Replaces `el`'s contents with selection controls and one active detail. */
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

  const activeIndex = Math.max(0, details.findIndex((detail) => detail.key === handlers.activeKey));
  const detail = details[activeIndex]!;
  const navigation = document.createElement("div");
  navigation.className = "landscape-sidebar-navigation";
  const previous = document.createElement("button");
  previous.type = "button";
  previous.dataset.detailPrev = "";
  previous.setAttribute("aria-label", "Previous selected detail");
  previous.textContent = "←";
  previous.disabled = details.length === 1;
  previous.addEventListener("click", () => {
    handlers.onActivate(details[(activeIndex - 1 + details.length) % details.length]!.key);
  });
  const next = document.createElement("button");
  next.type = "button";
  next.dataset.detailNext = "";
  next.setAttribute("aria-label", "Next selected detail");
  next.textContent = "→";
  next.disabled = details.length === 1;
  next.addEventListener("click", () => {
    handlers.onActivate(details[(activeIndex + 1) % details.length]!.key);
  });
  navigation.append(previous, next);
  el.appendChild(navigation);

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
