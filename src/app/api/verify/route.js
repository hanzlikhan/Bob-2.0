import { NextResponse } from "next/server";
import { verify } from "@/lib/agents/verify";
import { fix } from "@/lib/agents/fix";
import { diagnose } from "@/lib/agents/diagnose";
import { readRepo } from "@/lib/readRepo";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/verify?fixId=<project-name>
 *
 * Runs the full verify cycle: diagnose → fix → apply patches → run tests.
 * Returns whether tests pass, stdout/stderr, and timing info.
 *
 * @returns {{ passed: boolean, stdout: string, stderr: string, durationMs: number }}
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const fixId = searchParams.get("fixId");

    // ── Input validation ──────────────────────────────────────────────────────
    if (!fixId || typeof fixId !== "string") {
      return NextResponse.json(
        { error: "Missing required query param: fixId" },
        { status: 400 }
      );
    }

    if (!/^[\w.\-]+$/.test(fixId)) {
      return NextResponse.json(
        { error: "Invalid fixId format" },
        { status: 400 }
      );
    }

    // ── Resolve repo path ─────────────────────────────────────────────────────
    const projectsRoot = path.join(process.cwd(), "sample-projects");
    const workDir = path.join(projectsRoot, fixId);

    if (!workDir.startsWith(projectsRoot)) {
      return NextResponse.json(
        { error: "Invalid fixId: path traversal detected" },
        { status: 400 }
      );
    }

    const stat = await fs.stat(workDir).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      return NextResponse.json(
        { error: `Project "${fixId}" not found in sample-projects/` },
        { status: 404 }
      );
    }

    // ── Read repo, diagnose, fix ──────────────────────────────────────────────
    const repoFiles = await readRepo(workDir);
    const errorLog = await fs
      .readFile(path.join(workDir, "error.log"), "utf8")
      .catch(() => "");

    const diagnosis = await diagnose({ repoFiles, errorLog });
    const fixResult = await fix({ diagnosis, repoFiles });

    // ── Run verification (apply patches + test) ───────────────────────────────
    const result = await verify({
      workDir,
      patches: fixResult.patches || [],
    });

    return NextResponse.json({
      passed: result.passed ?? false,
      stdout: (result.stdout ?? "").slice(0, 10_000),
      stderr: (result.stderr ?? "").slice(0, 10_000),
      durationMs: result.durationMs ?? 0,
      lang: result.lang ?? null,
      patchCount: fixResult.patches?.length ?? 0,
      rootCause: diagnosis.rootCause ?? null,
      rationale: fixResult.rationale ?? null,
    });
  } catch (err) {
    console.error("[api/verify] error:", err);
    return NextResponse.json(
      { error: err.message || "Verification failed" },
      { status: 500 }
    );
  }
}
