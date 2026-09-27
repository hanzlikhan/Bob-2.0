import { cloneRepo, normalizeGithubUrl } from "@/lib/cloneRepo";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime     = "nodejs";
export const maxDuration = 120;

export async function POST(req) {
  try {
    const { repoUrl } = await req.json();

    const normalizedUrl = normalizeGithubUrl(repoUrl);
    if (!normalizedUrl) {
      return Response.json({ error: "Only public github.com URLs are supported (e.g. https://github.com/owner/repository)" }, { status: 400 });
    }

    if (process.env.VERCEL) {
      return Response.json({ error: "Cloning is disabled on Vercel (no writable filesystem)" }, { status: 400 });
    }

    const repoName = normalizedUrl.split("/").pop();
    const safeName = `clone-${repoName}-${Date.now()}`;
    const target   = path.join(process.cwd(), "sample-projects", safeName);

    await cloneRepo(normalizedUrl, target);

    // Capture initial test failure for the pipeline's error.log
    let errLog = "(no test failures captured)";
    try {
      const hasPkg = await fs.access(path.join(target, "package.json")).then(() => true).catch(() => false);
      const hasReq = await fs.access(path.join(target, "requirements.txt")).then(() => true).catch(() => false);

      if (hasPkg || hasReq) {
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const run = promisify(exec);
        const pyBin = process.platform === "win32" ? "python" : "python3";
        const cmd = hasPkg
          ? "npm test --silent"
          : `${pyBin} -m pytest -q`;
        try {
          await run(cmd, { cwd: target, timeout: 60000 });
        } catch (e) {
          errLog = `${e.stdout || ""}\n${e.stderr || ""}` || "(empty)";
        }
      }
    } catch { /* ignore */ }

    await fs.writeFile(path.join(target, "error.log"), errLog, "utf8");

    return Response.json({ projectName: safeName });
  } catch (err) {
    return Response.json({ error: err.message || "Clone failed" }, { status: 500 });
  }
}
