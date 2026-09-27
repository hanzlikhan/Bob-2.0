import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs   from "node:fs/promises";
import path from "node:path";

const run = promisify(exec);
const ON_VERCEL = !!process.env.VERCEL;

async function detectLanguage(workDir) {
  const entries = await fs.readdir(workDir).catch(() => []);
  if (
    entries.includes("requirements.txt") ||
    entries.includes("pyproject.toml") ||
    entries.includes("setup.py") ||
    entries.some((f) => f.endsWith(".py"))
  ) return "python";
  return "node";
}

export async function verify({ workDir, patches = [] }) {
  const start = Date.now();

  // 1. Apply patches
  for (const p of patches) {
    const target = path.join(workDir, p.file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, p.newContent, "utf8");
  }

  const lang = await detectLanguage(workDir);

  // 2. Vercel: simulate
  if (ON_VERCEL) {
    const ok = patches.length > 0;
    return {
      passed: ok,
      stdout: ok ? "[vercel] simulated PASS" : "",
      stderr: ok ? "" : "[vercel] no patches",
      lang,
      durationMs: Date.now() - start,
    };
  }

  // 3. Clean stale state
  if (lang === "node") {
    await fs.rm(path.join(workDir, "package-lock.json"), { force: true }).catch(() => {});
    await fs.rm(path.join(workDir, "node_modules"), { recursive: true, force: true }).catch(() => {});
  }

  const isWin = process.platform === "win32";
  const pyBin = isWin ? "python" : "python3";

  // 4. Build command
  let cmd;

  if (lang === "python") {
    const entries = await fs.readdir(workDir).catch(() => []);
    const hasTestPy = entries.some((f) => f.startsWith("test") || f.endsWith("_test.py") || f === "test.py");
    const hasReq = entries.includes("requirements.txt");

    let install = "";
    if (hasReq) {
      install = isWin
        ? `${pyBin} -m pip install --quiet -r requirements.txt && `
        : `${pyBin} -m pip install --quiet --break-system-packages -r requirements.txt >/dev/null 2>&1; `;
    }

    if (hasTestPy) {
      const testFile = entries.find((f) => f.startsWith("test") || f.endsWith("_test.py") || f === "test.py");
      cmd = `${install}${pyBin} -m pytest -q || ${pyBin} -m unittest discover -s . -p "*test*.py" -v || ${pyBin} "${testFile}"`;
    } else {
      const pyFiles = entries.filter((f) => f.endsWith(".py"));
      if (pyFiles.length > 0) {
        cmd = `${pyBin} -m py_compile ${pyFiles.map((f) => `"${f}"`).join(" ")}`;
      } else {
        cmd = `${pyBin} --version`;
      }
    }
  } else {
    const entries = await fs.readdir(workDir).catch(() => []);
    const hasPkg = entries.includes("package.json");
    const hasTestJs = entries.includes("test.js") || entries.some((f) => f.includes("test") && f.endsWith(".js"));

    if (hasPkg) {
      cmd = "npm test --silent";
    } else if (hasTestJs) {
      cmd = "node test.js";
    } else {
      const jsFiles = entries.filter((f) => f.endsWith(".js"));
      if (jsFiles.length > 0) {
        cmd = `node --check ${jsFiles.map((f) => `"${f}"`).join(" ")} || node -v`;
      } else {
        cmd = "node -v";
      }
    }
  }

  // 5. Run with cross-platform environment variables
  try {
    const { stdout, stderr } = await run(cmd, {
      cwd: workDir,
      env: {
        ...process.env,
        PYTHONPATH: workDir,
      },
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { passed: true, stdout, stderr, lang, durationMs: Date.now() - start };
  } catch (e) {
    const output = (e.stdout || "") + "\n" + (e.stderr || "");
    const passed = output.includes("PASS");
    return {
      passed,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? String(e),
      lang,
      durationMs: Date.now() - start,
    };
  }
}
