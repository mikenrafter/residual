import { beforeAll, describe, expect, test } from "bun:test";

type LedgerPanelsModule = {
  mountLedgerPanels?: (container: HTMLElement) => { destroy: () => void };
};

let mod: LedgerPanelsModule = {};

beforeAll(async () => {
  mod = (await import("./ledger-panels").catch(() => ({}))) as LedgerPanelsModule;
});

function fixture(): HTMLElement {
  document.body.innerHTML = `
    <div data-page-ledger-tabs>
      <button data-page-ledger-tab="implementation" aria-selected="true">implementation</button>
      <button data-page-ledger-tab="defense" aria-selected="false">defense</button>
    </div>
    <section data-ledger-panel="implementation"><div data-landscape></div></section>
    <section data-ledger-panel="defense" hidden></section>
    <details data-view="modify">
      <button data-modify-ledger-switch="implementation" aria-pressed="true">implementation</button>
      <button data-modify-ledger-switch="defense" aria-pressed="false">defense</button>
      <div data-modify-panel="implementation"></div>
      <div data-modify-panel="defense" hidden></div>
    </details>`;
  return document.body;
}

describe("synchronized implementation and defense panels", () => {
  test("the page switch updates both the page panel and Modify form panel", () => {
    const container = fixture();
    const handle = mod.mountLedgerPanels?.(container);
    expect(handle).toBeDefined();
    container.querySelector<HTMLElement>('[data-page-ledger-tab="defense"]')?.click();
    expect(container.querySelector<HTMLElement>('[data-ledger-panel="implementation"]')?.hidden).toBe(true);
    expect(container.querySelector<HTMLElement>('[data-ledger-panel="defense"]')?.hidden).toBe(false);
    expect(container.querySelector<HTMLElement>('[data-modify-panel="implementation"]')?.hidden).toBe(true);
    expect(container.querySelector<HTMLElement>('[data-modify-panel="defense"]')?.hidden).toBe(false);
    expect(container.querySelector('[data-modify-ledger-switch="defense"]')?.getAttribute("aria-pressed")).toBe("true");
    handle?.destroy();
  });

  test("the Modify switch updates the page-level switch and panels", () => {
    const container = fixture();
    const handle = mod.mountLedgerPanels?.(container);
    container.querySelector<HTMLElement>('[data-modify-ledger-switch="defense"]')?.click();
    expect(container.querySelector('[data-page-ledger-tab="defense"]')?.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector<HTMLElement>('[data-ledger-panel="defense"]')?.hidden).toBe(false);
    handle?.destroy();
  });

  test("revealing implementation asks the hidden landscape to refresh after it has size again", () => {
    const container = fixture();
    let refreshes = 0;
    container.addEventListener("landscape-panel-visible", () => { refreshes += 1; });
    const handle = mod.mountLedgerPanels?.(container);
    container.querySelector<HTMLElement>('[data-page-ledger-tab="defense"]')?.click();
    container.querySelector<HTMLElement>('[data-page-ledger-tab="implementation"]')?.click();
    expect(refreshes).toBe(1);
    handle?.destroy();
  });
});
