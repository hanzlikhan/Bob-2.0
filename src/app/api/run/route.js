import { runPipeline } from "@/lib/agents/headAgent";
import { readRepo }    from "@/lib/readRepo";
import { logRun, getLastRun } from "@/lib/supabase/client";
import { cloneRepo }   from "@/lib/cloneRepo";
import { resolveUploadId } from "@/app/api/upload/route";
import { checkRateLimit, rateLimitResponse } from "@/lib/rateLimit";
import fs   from "node:fs/promises";
import path from "node:path";
import os   from "node:os";

export const runtime    = "nodejs";
export const maxDuration = 300;

/** Regex for valid GitHub repo URLs */
const GITHUB_URL_RE = /^https:\/\/github\.com\/[\w.\-]+\/[\w.\-]+\/?$/;

/** Regex for valid upload IDs (hex token) */
const UPLOAD_ID_RE = /^[a-f0-9]{16}$/;

/**
 * Validate that a project name exists in sample-projects/.
 *
 * @param {string} projectName
 * @returns {Promise<{ valid: boolean, workDir?: string, error?: string }>}
 */
async function validateProjectName(projectName) {
  if (!projectName || typeof projectName !== "string") {
    return { valid: false, error: "projectName is required" };
  }

  // Only allow safe characters
  if (!/^[\w.\-]+$/.test(projectName)) {
    return { valid: false, error: "Invalid projectName format" };
  }

  const projectsRoot = path.join(process.cwd(), "sample-projects");
  const workDir = path.join(projectsRoot, projectName);

  // Prevent directory traversal
  if (!workDir.startsWith(projectsRoot)) {
    return { valid: false, error: "Invalid projectName: path traversal detected" };
  }

  const stat = await fs.stat(workDir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    return { valid: false, error: `Project "${projectName}" not found` };
  }

  return { valid: true, workDir };
}

// ── GET — fetch last run from Supabase ────────────────────────────────────────
/**
 * GET /api/run?project=<name>
 *
 * Fetch the most recent pipeline run result for a given project.
 *
 * @returns {object} The last run result or 404 if not found
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const projectName = searchParams.get("project");
  if (!projectName) return Response.json({ error: "project required" }, { status: 400 });
  const last = await getLastRun(projectName);
  if (!last) return Response.json({ error: "no run found" }, { status: 404 });
  return Response.json(last);
}

// ── POST — run pipeline with SSE streaming ───────────────────────────────────
/**
 * POST /api/run
 *
 * Run the full diagnose→fix→verify pipeline with real-time SSE streaming.
 * Accepts one of: { projectName, githubUrl, uploadId }
 *
 * Rate limited: max 5 requests per minute per IP.
 *
 * @returns {Response} SSE event stream
 */
export async function POST(req) {
  // ── Rate limiting ─────────────────────────────────────────────────────────
  const isDev = process.env.NODE_ENV === "development";
  const { limited, retryAfterMs } = checkRateLimit(req, {
    maxRequests: isDev ? 100 : 30,
    windowMs: 60_000,
  });

  if (limited) {
    return rateLimitResponse(retryAfterMs);
  }

  // ── Parse and validate body ─────────────────────────────────────────────
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { projectName, githubUrl, uploadId } = body;

  if (!projectName && !githubUrl && !uploadId) {
    return Response.json(
      { error: "projectName, githubUrl, or uploadId required" },
      { status: 400 }
    );
  }

  // ── Input validation ──────────────────────────────────────────────────────
  if (githubUrl && !GITHUB_URL_RE.test(githubUrl.trim().replace(/\/$/, ""))) {
    return Response.json(
      { error: "Invalid GitHub URL. Expected: https://github.com/owner/repo" },
      { status: 400 }
    );
  }

  if (uploadId && !UPLOAD_ID_RE.test(uploadId)) {
    return Response.json(
      { error: "Invalid uploadId format" },
      { status: 400 }
    );
  }

  if (projectName && !githubUrl && !uploadId) {
    const validation = await validateProjectName(projectName);
    if (!validation.valid) {
      return Response.json({ error: validation.error }, { status: 400 });
    }
  }

  // ── SSE stream setup ──────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const stream  = new TransformStream();
  const writer  = stream.writable.getWriter();

  let writerClosed = false;

  /**
   * Send an SSE event to the client.
   * @param {string} event - Event name
   * @param {object} data - JSON-serializable data
   */
  function send(event, data) {
    if (writerClosed) return;
    writer
      .write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      .catch(() => {});
  }

  // ── Heartbeat to keep connection alive ──────────────────────────────────
  const heartbeat = setInterval(() => {
    send("heartbeat", { ts: Date.now() });
  }, 5000);

  // Run pipeline in background, stream events to client
  (async () => {
    let workDir;
    let cleanupTmp = false;

    try {
      // ── Resolve work directory ──────────────────────────────────────────────
      if (githubUrl) {
        send("step", { step: "clone", status: "working", message: `Cloning ${githubUrl}…` });
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bob-"));
        cleanupTmp = true;
        workDir = tmpDir;
        await cloneRepo(githubUrl, tmpDir);
        send("step", { step: "clone", status: "done", message: "Repository cloned." });
      } else if (uploadId) {
        // Resolve short token → actual tmp dir path
        const resolvedDir = await resolveUploadId(uploadId);
        if (!resolvedDir) {
          throw new Error(`Upload session not found (token: ${uploadId}). Please re-upload.`);
        }
        workDir    = resolvedDir;
        cleanupTmp = true;
      } else {
        const projectsRoot = path.join(process.cwd(), "sample-projects");
        workDir = path.join(projectsRoot, projectName);
        if (!workDir.startsWith(projectsRoot)) throw new Error("invalid projectName");
      }

      const label = githubUrl
        ? githubUrl.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "")
        : uploadId
          ? path.basename(uploadId)
          : projectName;

      const repoFiles = await readRepo(workDir);
      const errorLog  = await fs.readFile(path.join(workDir, "error.log"), "utf8").catch(() => "");

      // ── Run pipeline, emit SSE events per step ──────────────────────────────
      const result = await runPipeline({
        repoFiles, errorLog, workDir,
        onStep: (e) => send("step", e),
      });

      // ── Persist to Supabase (non-blocking) ──────────────────────────────────
      logRun({ projectName: label, result }).catch((err) => {
        console.warn("[run] logRun failed (non-fatal):", err.message);
      });

      send("done", { ...result, projectLabel: label });
    } catch (e) {
      send("error", { message: e.message });
    } finally {
      clearInterval(heartbeat);

      if (cleanupTmp && workDir) {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
      if (!writerClosed) {
        writerClosed = true;
        writer.close().catch(() => {});
      }
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
