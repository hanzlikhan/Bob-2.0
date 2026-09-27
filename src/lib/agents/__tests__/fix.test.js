/**
 * Tests for the fix agent.
 *
 * Run with: BOB_MOCK=true node src/lib/agents/__tests__/fix.test.js
 */

import { fix } from "../fix.js";
import { diagnose } from "../diagnose.js";
import { readRepo } from "../../readRepo.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES = path.resolve(__dirname, "../../../../sample-projects");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

async function testFixNode() {
  console.log("\n[fix] broken-node:");
  const repoFiles = await readRepo(path.join(SAMPLES, "broken-node"));
  const diagnosis = await diagnose({ repoFiles, errorLog: "Cannot find module left-pad" });
  const result = await fix({ diagnosis, repoFiles });

  assert(Array.isArray(result.patches), "patches is an array");
  assert(result.patches.length > 0, "at least one patch generated");
  assert(typeof result.rationale === "string", "rationale is a string");

  // Verify no lockfiles are patched
  const lockPatches = result.patches.filter((p) =>
    /package-lock|yarn\.lock|pnpm-lock/.test(p.file)
  );
  assert(lockPatches.length === 0, "no lockfile patches");
}

async function testFixPython() {
  console.log("\n[fix] broken-python:");
  const repoFiles = await readRepo(path.join(SAMPLES, "broken-python"));
  const diagnosis = await diagnose({ repoFiles, errorLog: "FAILED test_sum_positive" });
  const result = await fix({ diagnosis, repoFiles });

  assert(Array.isArray(result.patches), "patches is an array");
  assert(result.patches.length > 0, "at least one patch generated");

  // Verify patches target .py files for Python projects
  const pyPatches = result.patches.filter((p) => p.file.endsWith(".py"));
  assert(pyPatches.length > 0, "patches target .py files");
}

async function testFixLogic() {
  console.log("\n[fix] broken-logic:");
  const repoFiles = await readRepo(path.join(SAMPLES, "broken-logic"));
  const diagnosis = await diagnose({ repoFiles, errorLog: "isAdult(18) expected true" });
  const result = await fix({ diagnosis, repoFiles });

  assert(Array.isArray(result.patches), "patches is an array");
  assert(result.patches.length > 0, "at least one patch generated");

  // Each patch should have file and newContent
  for (const p of result.patches) {
    assert(typeof p.file === "string" && p.file.length > 0, `patch has file: ${p.file}`);
    assert(typeof p.newContent === "string" && p.newContent.length > 0, `patch has newContent`);
  }
}

async function testFixEmptyDiagnosis() {
  console.log("\n[fix] empty diagnosis:");
  const result = await fix({
    diagnosis: { rootCause: "", evidence: [], confidence: 0 },
    repoFiles: "",
  });

  assert(Array.isArray(result.patches), "patches is an array (even if empty)");
  assert(typeof result.rationale === "string", "rationale is a string");
}

async function main() {
  console.log("=== Fix Agent Tests ===");
  process.env.BOB_MOCK = "true";

  await testFixNode();
  await testFixPython();
  await testFixLogic();
  await testFixEmptyDiagnosis();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
