import { NextResponse } from "next/server";
import { fix } from "@/lib/agents/fix";
import { diagnose } from "@/lib/agents/diagnose";
import { readRepo } from "@/lib/readRepo";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/fix?diagnosisId=<project-name>&rootCause=<optional-override>
 *
 * Runs the fix agent against a diagnosed project. If no prior diagnosis is
 * provided, it first runs diagnose automatically to get root-cause info.
 *
 * @returns {{ patches: Array<{file: string, newContent: string}>, rationale: string }}
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const diagnosisId = searchParams.get("diagnosisId");

    // ── Input validation ──────────────────────────────────────────────────────
    if (!diagnosisId || typeof diagnosisId !== "string") {
      return NextResponse.json(
        { error: "Missing required query param: diagnosisId" },
        { status: 400 }
      );
    }

    if (!/^[\w.\-]+$/.test(diagnosisId)) {
      return NextResponse.json(
        { error: "Invalid diagnosisId format" },
        { status: 400 }
      );
    }

    // ── Resolve repo path ─────────────────────────────────────────────────────
    const projectsRoot = path.join(process.cwd(), "sample-projects");
    const workDir = path.join(projectsRoot, diagnosisId);

    if (!workDir.startsWith(projectsRoot)) {
      return NextResponse.json(
        { error: "Invalid diagnosisId: path traversal detected" },
        { status: 400 }
      );
    }

    const stat = await fs.stat(workDir).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      return NextResponse.json(
        { error: `Project "${diagnosisId}" not found in sample-projects/` },
        { status: 404 }
      );
    }

    // ── Read repo files ───────────────────────────────────────────────────────
    const repoFiles = await readRepo(workDir);
    const errorLog = await fs
      .readFile(path.join(workDir, "error.log"), "utf8")
      .catch(() => "");

    // ── Get or generate diagnosis ─────────────────────────────────────────────
    let diagnosis;
    const rootCauseOverride = searchParams.get("rootCause");

    if (rootCauseOverride) {
      diagnosis = {
        rootCause: rootCauseOverride,
        evidence: [],
        confidence: 1.0,
      };
    } else {
      diagnosis = await diagnose({ repoFiles, errorLog });
    }

    // ── Run fix agent ─────────────────────────────────────────────────────────
    const result = await fix({ diagnosis, repoFiles });

    return NextResponse.json({
      patches: Array.isArray(result.patches) ? result.patches : [],
      rationale: result.rationale ?? null,
    });
  } catch (err) {
    console.error("[api/fix] error:", err);
    return NextResponse.json(
      { error: err.message || "Fix generation failed" },
      { status: 500 }
    );
  }
}
