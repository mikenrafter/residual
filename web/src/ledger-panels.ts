type LedgerSide = "implementation" | "defense";

type LedgerPanelsHandle = { destroy: () => void };

const NOOP_HANDLE: LedgerPanelsHandle = { destroy: () => {} };

/** Keep the optional page and Modify ledger switches on one shared side. */
export function mountLedgerPanels(container: HTMLElement): LedgerPanelsHandle {
  const pageTabs = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-page-ledger-tab]"));
  const modifyTabs = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-modify-ledger-switch]"));
  const ledgerPanels = Array.from(container.querySelectorAll<HTMLElement>("[data-ledger-panel]"));
  const modifyPanels = Array.from(container.querySelectorAll<HTMLElement>("[data-modify-panel]"));

  if (pageTabs.length === 0 && modifyTabs.length === 0 && ledgerPanels.length === 0 && modifyPanels.length === 0) {
    return NOOP_HANDLE;
  }

  const initiallySelected = pageTabs.find((tab) => tab.getAttribute("aria-selected") === "true")
    ?.dataset.pageLedgerTab;
  let active: LedgerSide = initiallySelected === "defense" ? "defense" : "implementation";

  const update = (next: LedgerSide): void => {
    if (next !== "implementation" && next !== "defense") return;
    const changed = next !== active;
    active = next;

    for (const tab of pageTabs) {
      const selected = tab.dataset.pageLedgerTab === active;
      tab.setAttribute("aria-selected", String(selected));
      tab.classList.toggle("is-active", selected);
    }
    for (const tab of modifyTabs) {
      const selected = tab.dataset.modifyLedgerSwitch === active;
      tab.setAttribute("aria-selected", String(selected));
      // Retain the pressed state for older markup and assistive technology.
      tab.setAttribute("aria-pressed", String(selected));
      tab.classList.toggle("is-active", selected);
    }
    for (const panel of ledgerPanels) {
      panel.hidden = panel.dataset.ledgerPanel !== active;
    }
    for (const panel of modifyPanels) {
      panel.hidden = panel.dataset.modifyPanel !== active;
    }

    if (changed && active === "implementation") {
      const eventTarget = container.querySelector<HTMLElement>('[data-ledger-panel="implementation"]') ?? container;
      eventTarget.dispatchEvent(new CustomEvent("landscape-panel-visible", { bubbles: true }));
    }
  };

  const onClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const pageTab = target.closest<HTMLButtonElement>("[data-page-ledger-tab]");
    if (pageTab && container.contains(pageTab)) {
      update(pageTab.dataset.pageLedgerTab as LedgerSide);
      return;
    }
    const modifyTab = target.closest<HTMLButtonElement>("[data-modify-ledger-switch]");
    if (modifyTab && container.contains(modifyTab)) {
      update(modifyTab.dataset.modifyLedgerSwitch as LedgerSide);
    }
  };

  container.addEventListener("click", onClick);
  update(active);

  return {
    destroy: () => container.removeEventListener("click", onClick),
  };
}
