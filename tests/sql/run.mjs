// Runs every *.test.mjs in this folder; exits non-zero if any fails.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0;
for (const f of readdirSync(here).filter((f) => f.endsWith(".test.mjs")).sort()) {
  console.log(`\n# ${f}`);
  const r = spawnSync(process.execPath, [`${here}/${f}`], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} SQL test file(s) failed` : "\nAll SQL tests passed");
process.exit(failed ? 1 : 0);
