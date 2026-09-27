/**
 * Tests for the verify agent.
 *
 * Run with: BOB_MOCK=true node src/lib/agents/__tests__/verify.test.js
 *
 * NOTE: These tests actually apply patches and run test suites,
 * so they modify files on disk. They use sample-projects/ copies.
 */

import { verify } from "../verify.js";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
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

/**
 * Copy a sample project to a temp directory so tests don't mutate originals.
 */
async function copyProject(projectName) {
  const src = path.join(SAMPLES, projectName);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `bob-test-${projectName}-`));

  async function copyDir(from, to) {
    await fs.mkdir(to, { recursive: true });
    const entries = await fs.readdir(from, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(from, entry.name);
      const destPath = path.join(to, entry.name);
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  await copyDir(src, tmp);
  return tmp;
}

async function testVerifyWithPatches() {
  console.log("\n[verify] apply patches to broken-logic copy:");
  const workDir = await copyProject("broken-logic");

  try {
    const result = await verify({
      workDir,
      patches: [
        {
          file: "calculator.js",
          newContent: `function isAdult(age) {\n  return age >= 18;\n}\n\nfunction canDrive(hasLicense, hasPermit) {\n  return hasLicense || hasPermit;\n}\n\nmodule.exports = { isAdult, canDrive };\n`,
        },
      ],
    });

    assert(typeof result.passed === "boolean", "passed is boolean");
    assert(typeof result.durationMs === "number", "durationMs is a number");
    assert(result.durationMs > 0, "durationMs > 0");
    assert(typeof result.stdout === "string", "stdout is a string");
    assert(typeof result.stderr === "string", "stderr is a string");
    assert(result.lang === "node", "detected language is node");
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function testVerifyEmptyPatches() {
  console.log("\n[verify] empty patches:");
  const workDir = await copyProject("broken-logic");

  try {
    const result = await verify({ workDir, patches: [] });

    assert(typeof result.passed === "boolean", "passed is boolean");
    assert(typeof result.durationMs === "number", "durationMs is a number");
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function testVerifyResultShape() {
  console.log("\n[verify] result shape:");
  const workDir = await copyProject("broken-node");

  try {
    const result = await verify({ workDir, patches: [] });

    // Verify all expected fields exist
    const requiredFields = ["passed", "stdout", "stderr", "durationMs", "lang"];
    for (const field of requiredFields) {
      assert(field in result, `result has "${field}" field`);
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  console.log("=== Verify Agent Tests ===");

  // Skip on Vercel
  if (process.env.VERCEL) {
    console.log("Skipping verify tests on Vercel (no writable filesystem)");
    return;
  }

  await testVerifyWithPatches();
  await testVerifyEmptyPatches();
  await testVerifyResultShape();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
