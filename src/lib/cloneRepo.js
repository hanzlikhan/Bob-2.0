import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const run = promisify(exec);

/** Max clone timeout in milliseconds (30 seconds) */
const CLONE_TIMEOUT_MS = 30_000;

/** Regex to validate public GitHub URLs */
const GITHUB_URL_RE = /^https:\/\/github\.com\/[\w.\-]+\/[\w.\-]+\/?$/;

/**
 * Detect the primary language of a cloned repo.
 *
 * @param {string} dir - Absolute path to the cloned repo
 * @returns {Promise<"python" | "node" | "unknown">}
 */
async function detectLanguage(dir) {
  const entries = await fs.readdir(dir).catch(() => []);
  const hasReq = entries.includes("requirements.txt") ||
                 entries.includes("pyproject.toml") ||
                 entries.includes("setup.py");
  if (hasReq) return "python";
  if (entries.includes("package.json")) return "node";
  if (entries.some((f) => f.endsWith(".py"))) return "python";
  return "unknown";
}

/**
 * Check whether a project has test files.
 *
 * @param {string} dir - Absolute path to the project
 * @param {"python" | "node" | "unknown"} language
 * @returns {Promise<boolean>}
 */
async function hasTestFiles(dir, language) {
  const entries = await fs.readdir(dir).catch(() => []);

  if (language === "python") {
    return entries.some((f) => f.startsWith("test_") || f.endsWith("_test.py"));
  }
  if (language === "node") {
    // Check for test script in package.json
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
      if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
        return true;
      }
    } catch { /* no package.json or invalid JSON */ }
    return entries.some((f) => f.includes("test") && f.endsWith(".js"));
  }
  return false;
}

/**
 * Normalize and validate any user-entered GitHub repository URL.
 * Supports:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - https://github.com/owner/repo/tree/main
 * - github.com/owner/repo
 *
 * @param {string} rawUrl
 * @returns {string|null} Normalized https://github.com/owner/repo URL or null if invalid
 */
export function normalizeGithubUrl(rawUrl) {
  let u = (rawUrl || "").trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) {
    u = "https://" + u;
  }
  try {
    const parsed = new URL(u);
    if (!parsed.hostname.includes("github.com")) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, "");
    return `https://github.com/${owner}/${repo}`;
  } catch {
    return null;
  }
}

/**
 * Clone a public GitHub repository into `destDir` with safety checks.
 *
 * Features:
 *  - Validates URL is a public github.com repo
 *  - Enforces 30-second timeout to prevent hangs
 *  - Shallow clone (--depth 1) to minimise bandwidth
 *  - Cleans up partial clone on failure
 *  - Returns metadata about the cloned repo
 *
 * @param {string} githubUrl - The GitHub repository URL (https://github.com/owner/repo)
 * @param {string} destDir   - Absolute path to clone into
 * @returns {Promise<{ repoPath: string, language: string, hasTests: boolean }>}
 * @throws {Error} If URL is invalid, clone times out, or git fails
 */
export async function cloneRepo(githubUrl, destDir) {
  // ── Validate & Normalize URL ─────────────────────────────────────────
  const normalizedUrl = normalizeGithubUrl(githubUrl);

  if (!normalizedUrl) {
    throw new Error(
      "Invalid GitHub URL. Expected format: https://github.com/owner/repository"
    );
  }

  const cloneUrl = `${normalizedUrl}.git`;

  // ── Validate destination ────────────────────────────────────────────────────
  const resolvedDest = path.resolve(destDir);

  // ── Clone with timeout ──────────────────────────────────────────────────────
  const cmd = `git clone --depth 1 "${cloneUrl}" "${resolvedDest}"`;

  try {
    await run(cmd, {
      timeout: CLONE_TIMEOUT_MS,
      maxBuffer: 5 * 1024 * 1024,
    });
  } catch (err) {
    // ── Cleanup on failure ──────────────────────────────────────────────────
    await fs.rm(resolvedDest, { recursive: true, force: true }).catch(() => {});

    if (err.killed || err.signal === "SIGTERM") {
      throw new Error(
        `git clone timed out after ${CLONE_TIMEOUT_MS / 1000}s. ` +
        "The repository may be too large or the network is slow."
      );
    }

    const stderr = (err.stderr || "").trim();
    if (stderr.includes("Repository not found")) {
      throw new Error(
        "Repository not found. Ensure it exists and is public."
      );
    }

    throw new Error(`git clone failed: ${stderr || err.message}`);
  }

  // ── Gather metadata ─────────────────────────────────────────────────────────
  const language = await detectLanguage(resolvedDest);
  const hasTests = await hasTestFiles(resolvedDest, language);

  return {
    repoPath: resolvedDest,
    language,
    hasTests,
  };
}
