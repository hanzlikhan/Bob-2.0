/**
 * Tests for the diagnose agent.
 *
 * Run with: BOB_MOCK=true node src/lib/agents/__tests__/diagnose.test.js
 *
 * Uses BOB_MOCK=true to get deterministic responses without a real API key.
 */

import { diagnose } from "../diagnose.js";
import { readRepo } from "../../readRepo.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES = path.resolve(__dirname, "../../../../sample-projects");

// ── Helpers ──────────────────────────────────────────────────────────────────
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

// ── Tests ────────────────────────────────────────────────────────────────────
async function testDiagnoseNode() {
  console.log("\n[diagnose] broken-node:");
  const repoFiles = await readRepo(path.join(SAMPLES, "broken-node"));
  const result = await diagnose({ repoFiles, errorLog: "Cannot find module left-pad" });

  assert(result.rootCause && result.rootCause.length > 0, "rootCause is non-empty");
  assert(Array.isArray(result.evidence), "evidence is an array");
  assert(typeof result.confidence === "number", "confidence is a number");
  assert(result.confidence >= 0 && result.confidence <= 1, "confidence is between 0 and 1");
}

async function testDiagnosePython() {
  console.log("\n[diagnose] broken-python:");
  const repoFiles = await readRepo(path.join(SAMPLES, "broken-python"));
  const result = await diagnose({ repoFiles, errorLog: "FAILED test_sum_positive" });

  assert(result.rootCause && result.rootCause.length > 0, "rootCause is non-empty");
  assert(Array.isArray(result.evidence), "evidence is an array");
  assert(typeof result.confidence === "number", "confidence is a number");
}

async function testDiagnoseLogic() {
  console.log("\n[diagnose] broken-logic:");
  const repoFiles = await readRepo(path.join(SAMPLES, "broken-logic"));
  const result = await diagnose({ repoFiles, errorLog: "isAdult(18) expected true" });

  assert(result.rootCause && result.rootCause.length > 0, "rootCause is non-empty");
  assert(Array.isArray(result.evidence), "evidence is an array");
}

async function testDiagnoseEmptyInput() {
  console.log("\n[diagnose] empty input:");
  const result = await diagnose({ repoFiles: "", errorLog: "" });

  assert(result.rootCause !== undefined, "returns a rootCause even with empty input");
  assert(Array.isArray(result.evidence), "evidence is an array");
}

// ── Run all tests ────────────────────────────────────────────────────────────
async function main() {
  console.log("=== Diagnose Agent Tests ===");
  process.env.BOB_MOCK = "true";

  await testDiagnoseNode();
  await testDiagnosePython();
  await testDiagnoseLogic();
  await testDiagnoseEmptyInput();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
