import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

/**
 * Description metadata for built-in sample projects.
 * Cloned repos get auto-generated descriptions.
 */
const PROJECT_DESCRIPTIONS = {
  "broken-node":        "Node.js project with a missing npm dependency (left-pad).",
  "broken-logic":       "Node.js project with logic bugs in comparison operators.",
  "broken-python":      "Python project with off-by-one and boolean errors.",
  "api-error-handling": "Node.js API user handler crashing on null property access.",
  "data-pipeline-bug":  "Python data metrics module crashing with ZeroDivisionError.",
};

/**
 * Detect language for a project directory by checking marker files.
 *
 * @param {string} projectDir - Absolute path to the project directory
 * @returns {Promise<"python" | "node" | "unknown">}
 */
async function detectLanguage(projectDir) {
  const entries = await fs.readdir(projectDir).catch(() => []);

  const hasRequirements = entries.includes("requirements.txt") ||
                          entries.includes("pyproject.toml") ||
                          entries.includes("setup.py");
  if (hasRequirements) return "python";

  if (entries.includes("package.json")) return "node";
  if (entries.some((f) => f.endsWith(".py"))) return "python";
  return "unknown";
}

/**
 * Count source files in a project (non-recursive, top-level only).
 *
 * @param {string} projectDir
 * @returns {Promise<number>}
 */
async function countFiles(projectDir) {
  const entries = await fs.readdir(projectDir).catch(() => []);
  return entries.filter((e) => !e.startsWith(".") && !e.startsWith("node_modules")).length;
}

/**
 * Generate a human-readable description for cloned repos.
 *
 * @param {string} name - Directory name
 * @param {"python" | "node" | "unknown"} language
 * @returns {string}
 */
function generateDescription(name, language) {
  if (name.startsWith("clone-")) {
    const repoName = name.replace(/^clone-/, "").replace(/-\d+$/, "");
    const lang = language === "python" ? "Python" : language === "node" ? "Node.js" : "Unknown";
    return `Cloned ${lang} repository: ${repoName}`;
  }
  return `${language === "python" ? "Python" : language === "node" ? "Node.js" : "Unknown"} project`;
}

/**
 * GET /api/projects
 *
 * Lists all sample-projects/ directories with metadata:
 * language detection, description, and file count.
 *
 * @returns {{ projects: Array<{ name: string, language: string, description: string, fileCount: number }> }}
 */
export async function GET() {
  try {
    const dir = path.join(process.cwd(), "sample-projects");
    const entries = await fs.readdir(dir).catch(() => []);
    const projects = [];

    for (const name of entries) {
      if (name.startsWith(".")) continue;

      const projectDir = path.join(dir, name);
      const stat = await fs.stat(projectDir).catch(() => null);
      if (!stat?.isDirectory()) continue;

      const language = await detectLanguage(projectDir);
      const fileCount = await countFiles(projectDir);
      const description =
        PROJECT_DESCRIPTIONS[name] || generateDescription(name, language);

      projects.push({
        name,
        language,
        description,
        fileCount,
      });
    }

    // Sort: built-in projects first (no "clone-" prefix), then clones by name
    projects.sort((a, b) => {
      const aClone = a.name.startsWith("clone-") ? 1 : 0;
      const bClone = b.name.startsWith("clone-") ? 1 : 0;
      if (aClone !== bClone) return aClone - bClone;
      return a.name.localeCompare(b.name);
    });

    return Response.json({ projects });
  } catch (err) {
    console.error("[api/projects] error:", err);
    return Response.json(
      { error: err.message || "Failed to list projects" },
      { status: 500 }
    );
  }
}
