import { NextResponse } from "next/server";
import { diagnose } from "@/lib/agents/diagnose";
import { readRepo } from "@/lib/readRepo";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/diagnose?repoId=<project-name>&errorLog=<optional-error-text>
 *
 * Runs the diagnosis agent against a sample-project or a cloned repo.
 *
 * @returns {{ rootCause: string, evidence: string[], confidence: number }}
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const repoId = searchParams.get("repoId");

    // ── Input validation ──────────────────────────────────────────────────────
    if (!repoId || typeof repoId !== "string") {
      return NextResponse.json(
        { error: "Missing required query param: repoId" },
        { status: 400 }
      );
    }

    // Sanitise: only allow alphanumeric, dash, underscore, dot
    if (!/^[\w.\-]+$/.test(repoId)) {
      return NextResponse.json(
        { error: "Invalid repoId format" },
        { status: 400 }
      );
    }

    // ── Resolve repo path ─────────────────────────────────────────────────────
    const projectsRoot = path.join(process.cwd(), "sample-projects");
    const workDir = path.join(projectsRoot, repoId);

    // Prevent directory traversal
    if (!workDir.startsWith(projectsRoot)) {
      return NextResponse.json(
        { error: "Invalid repoId: path traversal detected" },
        { status: 400 }
      );
    }

    // Verify the directory exists
    const stat = await fs.stat(workDir).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      return NextResponse.json(
        { error: `Project "${repoId}" not found in sample-projects/` },
        { status: 404 }
      );
    }

    // ── Read repo files and error log ─────────────────────────────────────────
    const repoFiles = await readRepo(workDir);
    const errorLog =
      searchParams.get("errorLog") ||
      (await fs.readFile(path.join(workDir, "error.log"), "utf8").catch(() => ""));

    // ── Run diagnose agent ────────────────────────────────────────────────────
    const result = await diagnose({ repoFiles, errorLog });

    return NextResponse.json({
      rootCause: result.rootCause ?? null,
      evidence: Array.isArray(result.evidence) ? result.evidence : [],
      confidence: typeof result.confidence === "number" ? result.confidence : 0,
    });
  } catch (err) {
    console.error("[api/diagnose] error:", err);
    return NextResponse.json(
      { error: err.message || "Diagnosis failed" },
      { status: 500 }
    );
  }
}
