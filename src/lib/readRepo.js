import fs from "node:fs/promises";
import path from "node:path";

/**
 * Directories and files to completely skip during traversal.
 * Covers common build outputs, dependency dirs, and sensitive files.
 */
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".venv",
  "__pycache__",
  "dist",
  "build",
  ".cache",
  ".vercel",
  ".turbo",
  "coverage",
  ".nyc_output",
  ".tox",
  "egg-info",
]);

const IGNORE_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".DS_Store",
  "Thumbs.db",
]);

/**
 * File extensions we consider as readable source code / config.
 * Binary files are skipped entirely.
 */
const ALLOWED_EXTENSIONS = new Set([
  ".js",  ".jsx", ".ts",  ".tsx", ".mjs", ".cjs",
  ".py",  ".pyw",
  ".json", ".yaml", ".yml", ".toml",
  ".md",  ".txt",  ".csv",
  ".html", ".css",  ".scss", ".less",
  ".sh",  ".bash", ".zsh",
  ".sql",
  ".xml",
  ".cfg", ".ini", ".conf",
  ".env.example",
  ".gitignore",
  ".eslintrc",
  ".prettierrc",
]);

/** Max bytes per individual file before we truncate */
const MAX_FILE_BYTES = 15_000;

/**
 * Detect the primary language of a project based on marker files.
 *
 * @param {string[]} fileList - Relative file paths collected from the repo
 * @param {boolean} hasPackageJson - Whether package.json exists
 * @param {boolean} hasRequirements - Whether requirements.txt exists
 * @returns {"python" | "node" | "unknown"}
 */
function detectLanguage(fileList, hasPackageJson, hasRequirements) {
  if (hasRequirements) return "python";
  const hasPyFiles = fileList.some((f) => f.endsWith(".py"));
  if (hasPyFiles && !hasPackageJson) return "python";
  if (hasPackageJson) return "node";
  if (hasPyFiles) return "python";
  return "unknown";
}

/**
 * Check if a file extension is allowed for reading.
 *
 * @param {string} filename
 * @returns {boolean}
 */
function isAllowedFile(filename) {
  // Allow dotfiles like .gitignore, .eslintrc etc. that are in our set
  if (ALLOWED_EXTENSIONS.has(filename)) return true;
  const ext = path.extname(filename).toLowerCase();
  // No extension → could be Makefile, Dockerfile, etc. — allow if small
  if (!ext) return true;
  return ALLOWED_EXTENSIONS.has(ext);
}

/**
 * Read all source files under `dir` into one string with ---FILE--- separators.
 * Returns both the concatenated text and metadata about the repo.
 *
 * Features:
 *  - Ignores node_modules, .git, dist, build, .env, lockfiles
 *  - Caps total output to `maxBytes` (default 120KB) for Bob context limits
 *  - Per-file cap of 15KB to avoid one giant file consuming all budget
 *  - Detects language (Python vs Node)
 *  - Returns metadata alongside the text
 *
 * @param {string} dir - Absolute path to the project root
 * @param {number} [maxBytes=120000] - Max total bytes for concatenated output
 * @returns {Promise<string>} Concatenated file contents (for backward compat)
 */
export async function readRepo(dir, maxBytes = 120_000) {
  const meta = await readRepoWithMeta(dir, maxBytes);
  return meta.text;
}

/**
 * Enhanced version that returns metadata alongside the text content.
 *
 * @param {string} dir - Absolute path to the project root
 * @param {number} [maxBytes=120000] - Max total bytes for concatenated output
 * @returns {Promise<{
 *   text: string,
 *   files: string[],
 *   language: "python" | "node" | "unknown",
 *   hasPackageJson: boolean,
 *   hasRequirements: boolean,
 *   totalBytes: number,
 *   truncatedFiles: string[],
 *   skippedFiles: string[]
 * }>}
 */
export async function readRepoWithMeta(dir, maxBytes = 120_000) {
  let out = "";
  const files = [];
  const truncatedFiles = [];
  const skippedFiles = [];
  let hasPackageJson = false;
  let hasRequirements = false;
  let totalBytes = 0;

  /**
   * Recursively walk directories, collecting file contents.
   * @param {string} d - Current directory absolute path
   * @param {string} prefix - Relative path prefix for display
   */
  async function walk(d, prefix = "") {
    const entries = await fs.readdir(d, { withFileTypes: true }).catch(() => []);

    for (const e of entries) {
      const name = e.name;

      // Skip ignored directories
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(name) || name.startsWith(".")) continue;
        const rel = prefix ? `${prefix}/${name}` : name;
        await walk(path.join(d, name), rel);
        continue;
      }

      // Skip ignored files
      if (IGNORE_FILES.has(name) || name.startsWith(".env")) continue;

      const rel = prefix ? `${prefix}/${name}` : name;
      const full = path.join(d, name);

      // Track marker files
      if (name === "package.json") hasPackageJson = true;
      if (name === "requirements.txt") hasRequirements = true;

      // Skip binary / disallowed file types
      if (!isAllowedFile(name)) {
        skippedFiles.push(rel);
        continue;
      }

      // Check file size before reading
      const fileStat = await fs.stat(full).catch(() => null);
      if (!fileStat || !fileStat.isFile()) continue;

      // Skip very large individual files (likely generated/vendor)
      if (fileStat.size > MAX_FILE_BYTES * 2) {
        skippedFiles.push(rel);
        out += `\n--- ${rel} --- (skipped: ${(fileStat.size / 1024).toFixed(1)}KB exceeds limit)\n`;
        continue;
      }

      // Read file content
      const content = await fs.readFile(full, "utf8").catch(() => null);
      if (content === null) {
        skippedFiles.push(rel);
        continue;
      }

      files.push(rel);
      const fileBytes = Buffer.byteLength(content, "utf8");

      // Per-file truncation
      let usableContent = content;
      if (fileBytes > MAX_FILE_BYTES) {
        usableContent = content.slice(0, MAX_FILE_BYTES) + "\n… (truncated)";
        truncatedFiles.push(rel);
      }

      const chunk = `\n--- ${rel} ---\n${usableContent}\n`;
      const chunkBytes = Buffer.byteLength(chunk, "utf8");

      // Global budget check
      if (totalBytes + chunkBytes > maxBytes) {
        out += `\n--- ${rel} --- (truncated, total size limit reached)\n`;
        truncatedFiles.push(rel);
        break; // Stop walking — budget exhausted
      }

      out += chunk;
      totalBytes += chunkBytes;
    }
  }

  await walk(dir);

  const language = detectLanguage(files, hasPackageJson, hasRequirements);

  return {
    text: out,
    files,
    language,
    hasPackageJson,
    hasRequirements,
    totalBytes,
    truncatedFiles,
    skippedFiles,
  };
}
