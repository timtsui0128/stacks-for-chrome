import { cp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Chrome disallows dynamic import in service workers. A test-only static entry
// point exposes the actual event handlers without adding hooks to the package.
export async function testExtension(directory) {
  const target = join(directory, "test-extension");
  await cp(resolve("extension"), target, { recursive: true });
  const manifestPath = join(target, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.background.service_worker = "test-worker.js";
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(join(target, "test-worker.js"), 'import { controls } from "./src/background.js"; globalThis.stacksControls = controls;\n');
  return target;
}
