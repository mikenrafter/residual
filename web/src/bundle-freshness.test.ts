import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("generated browser bundle", () => {
  test("matches a fresh build of src/main.ts", () => {
    const dir = mkdtempSync(join(tmpdir(), "residual-view-bundle-"));
    const output = join(dir, "app.js");
    try {
      const build = Bun.spawnSync([
        "bun", "build", "src/main.ts", `--outfile=${output}`, "--target=browser", "--format=esm",
      ], { cwd: import.meta.dir + "/.." });
      expect(build.exitCode).toBe(0);
      expect(readFileSync(output, "utf8")).toBe(readFileSync(join(import.meta.dir, "../generated/app.js"), "utf8"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
