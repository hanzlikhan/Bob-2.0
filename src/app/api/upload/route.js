import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Allowed file extensions for upload (reject binaries) */
const ALLOWED_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".py", ".pyw",
  ".json", ".yaml", ".yml", ".toml",
  ".md", ".txt", ".csv",
  ".html", ".css", ".scss",
  ".sh", ".bash",
  ".sql", ".xml", ".cfg", ".ini",
]);

/** Max total upload size: 5MB */
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;

/** Max individual file size: 1MB */
const MAX_FILE_BYTES = 1 * 1024 * 1024;

/** Upload TTL: 1 hour in milliseconds */
const UPLOAD_TTL_MS = 60 * 60 * 1000;

/** Registry file path (maps short tokens → tmp directory paths) */
const REGISTRY_PATH = path.join(os.tmpdir(), "bob-uploads-registry.json");

/**
 * Read the upload registry from disk.
 * @returns {Promise<Record<string, { dir: string, createdAt: number }>>}
 */
async function readRegistry() {
  try {
    return JSON.parse(await fs.readFile(REGISTRY_PATH, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Write the upload registry to disk.
 * @param {Record<string, { dir: string, createdAt: number }>} obj
 */
async function writeRegistry(obj) {
  await fs.writeFile(REGISTRY_PATH, JSON.stringify(obj), "utf8");
}

/**
 * Clean up expired upload sessions (older than UPLOAD_TTL_MS).
 * Best-effort: never throws.
 */
async function cleanupExpired() {
  try {
    const reg = await readRegistry();
    const now = Date.now();
    let dirty = false;

    for (const [token, entry] of Object.entries(reg)) {
      const createdAt = typeof entry === "object" ? entry.createdAt : 0;
      if (now - createdAt > UPLOAD_TTL_MS) {
        const dir = typeof entry === "object" ? entry.dir : entry;
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        delete reg[token];
        dirty = true;
        console.log(`[upload] cleaned expired session: ${token}`);
      }
    }

    if (dirty) await writeRegistry(reg);
  } catch (err) {
    console.warn("[upload] cleanup error (non-fatal):", err.message);
  }
}

/**
 * Validate that a filename has an allowed extension.
 * @param {string} filename
 * @returns {boolean}
 */
function isAllowedFileType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (!ext) return false; // Reject files with no extension
  return ALLOWED_EXTENSIONS.has(ext);
}

/**
 * POST /api/upload
 *
 * Handle multipart file uploads. Stores files in a temporary directory
 * and returns a short token for later use by /api/run.
 *
 * Validates:
 *  - File types (js, py, json, txt, etc. only; rejects binaries)
 *  - Individual file size (max 1MB each)
 *  - Total upload size (max 5MB)
 *  - Directory traversal prevention via path.basename
 *
 * @returns {{ uploadId: string, fileCount: number, totalSize: number, fileNames: string[] }}
 */
export async function POST(req) {
  // Run cleanup on each upload request (non-blocking)
  cleanupExpired().catch(() => {});

  try {
    const formData = await req.formData();
    const files = formData.getAll("files");

    if (!files.length) {
      return Response.json(
        { error: "No files uploaded" },
        { status: 400 }
      );
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bob-upload-"));
    const fileNames = [];
    const rejected = [];
    let totalSize = 0;

    for (const file of files) {
      // Skip non-File entries (e.g. string form fields)
      if (typeof file === "string" || !file.name) continue;

      const safeName = path.basename(file.name);
      if (!safeName) continue;

      // ── Validate file type ──────────────────────────────────────────────────
      if (!isAllowedFileType(safeName)) {
        rejected.push({ file: safeName, reason: "File type not allowed" });
        continue;
      }

      // ── Read file bytes ─────────────────────────────────────────────────────
      const bytes = await file.arrayBuffer();

      // ── Validate individual file size ───────────────────────────────────────
      if (bytes.byteLength > MAX_FILE_BYTES) {
        rejected.push({
          file: safeName,
          reason: `Exceeds max file size (${(MAX_FILE_BYTES / 1024).toFixed(0)}KB)`,
        });
        continue;
      }

      // ── Validate total upload budget ────────────────────────────────────────
      if (totalSize + bytes.byteLength > MAX_TOTAL_BYTES) {
        rejected.push({
          file: safeName,
          reason: "Total upload size limit exceeded",
        });
        continue;
      }

      // ── Prevent directory traversal ─────────────────────────────────────────
      const dest = path.join(tmpDir, safeName);
      if (!dest.startsWith(tmpDir)) {
        rejected.push({ file: safeName, reason: "Invalid filename" });
        continue;
      }

      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, Buffer.from(bytes));
      fileNames.push(safeName);
      totalSize += bytes.byteLength;
    }

    if (!fileNames.length) {
      // Clean up empty tmp dir
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      return Response.json(
        {
          error: "No valid files accepted",
          rejected: rejected.length ? rejected : undefined,
        },
        { status: 400 }
      );
    }

    // ── Register the upload ───────────────────────────────────────────────────
    const token = crypto.randomBytes(8).toString("hex");
    const reg = await readRegistry();
    reg[token] = { dir: tmpDir, createdAt: Date.now() };
    await writeRegistry(reg);

    // ── Schedule cleanup after TTL ────────────────────────────────────────────
    setTimeout(async () => {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
        const currentReg = await readRegistry();
        delete currentReg[token];
        await writeRegistry(currentReg);
        console.log(`[upload] auto-cleaned session: ${token}`);
      } catch {
        /* best-effort cleanup */
      }
    }, UPLOAD_TTL_MS);

    console.log(`[upload] token=${token} dir=${tmpDir} files=${fileNames.join(",")}`);

    return Response.json({
      uploadId: token,
      fileCount: fileNames.length,
      totalSize,
      fileNames,
      rejected: rejected.length ? rejected : undefined,
    });
  } catch (err) {
    console.error("[upload] error:", err);
    return Response.json(
      { error: err.message || "Upload failed" },
      { status: 500 }
    );
  }
}

/**
 * Helper for /api/run to resolve a token → tmp directory path.
 * Consumes the token (one-time use) to prevent replay.
 *
 * @param {string} token - The upload session token
 * @returns {Promise<string|null>} The directory path or null if not found/expired
 */
export async function resolveUploadId(token) {
  if (!token || typeof token !== "string") return null;

  const reg = await readRegistry();
  const entry = reg[token];
  if (!entry) return null;

  const dir = typeof entry === "object" ? entry.dir : entry;

  // Validate the directory still exists
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    delete reg[token];
    await writeRegistry(reg).catch(() => {});
    return null;
  }

  // Consume the token
  delete reg[token];
  await writeRegistry(reg).catch(() => {});
  return dir;
}
