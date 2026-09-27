import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Support both the legacy ANON_KEY and the newer PUBLISHABLE_KEY naming
const key =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * Supabase client instance. Null if env vars are missing (offline mode).
 * All exported functions gracefully handle null client.
 */
export const supabase = url && key ? createClient(url, key) : null;

/** Timeout for Supabase operations (10 seconds) */
const SUPABASE_TIMEOUT_MS = 10_000;

/**
 * Wrap a Supabase promise with a timeout to prevent hanging.
 * Returns null on timeout instead of blocking the pipeline.
 *
 * @template T
 * @param {Promise<T>} promise - The Supabase operation
 * @param {string} label - Label for logging on timeout
 * @returns {Promise<T|null>}
 */
async function withTimeout(promise, label = "supabase") {
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out after ${SUPABASE_TIMEOUT_MS}ms`)),
        SUPABASE_TIMEOUT_MS)
      ),
    ]);
  } catch (err) {
    console.warn(`[supabase] ${label} failed (non-fatal):`, err.message);
    return null;
  }
}

/**
 * Safely execute a Supabase operation with error recovery.
 * Never throws — returns a fallback value on any failure.
 *
 * @template T
 * @param {() => Promise<T>} fn - The async operation to execute
 * @param {T} fallback - Value to return on failure
 * @param {string} label - Label for logging
 * @returns {Promise<T>}
 */
async function safeExec(fn, fallback, label = "supabase") {
  if (!supabase) return fallback;
  try {
    const result = await withTimeout(fn(), label);
    return result ?? fallback;
  } catch (err) {
    console.warn(`[supabase] ${label} error (non-fatal):`, err.message);
    return fallback;
  }
}

/**
 * Persist a full pipeline run to Supabase.
 * Best-effort: never throws, never blocks the pipeline.
 *
 * @param {object} params
 * @param {string} params.projectName - Human-readable project label
 * @param {object} params.result - Pipeline result from headAgent
 */
export async function logRun({ projectName, result }) {
  await safeExec(
    async () => {
      const { data: sub, error: subErr } = await supabase
        .from("submissions")
        .insert({
          project_name: projectName,
          success: result.success,
          attempts: result.attempts,
          total_ms: result.totalMs,
        })
        .select("id")
        .single();

      if (subErr || !sub) {
        console.warn("Supabase submissions insert failed:", subErr?.message);
        return;
      }

      // Insert timeline events (best-effort, don't block on failure)
      if (Array.isArray(result.timeline) && result.timeline.length > 0) {
        const { error: logErr } = await supabase.from("agent_logs").insert(
          result.timeline.map((ev) => ({
            submission_id: sub.id,
            step: ev.step,
            attempt: ev.attempt ?? null,
            status: ev.status ?? null,
            payload:
              ev.payload ?? ev.diagnosis ?? ev.fixResult ?? ev.verification ?? null,
            at_ms: ev.at ?? null,
          }))
        );
        if (logErr) {
          console.warn("Supabase agent_logs insert failed (non-fatal):", logErr.message);
        }
      }

      // Insert results (best-effort)
      const { error: resErr } = await supabase.from("results").insert({
        submission_id: sub.id,
        root_cause: result.diagnosis?.rootCause ?? null,
        patches: result.fix?.patches ?? [],
        verification_passed: result.verification?.passed ?? null,
        verification_stdout: (result.verification?.stdout ?? "").slice(0, 10000),
      });
      if (resErr) {
        console.warn("Supabase results insert failed (non-fatal):", resErr.message);
      }
    },
    undefined,
    "logRun"
  );
}

/**
 * Fetch the most recent pipeline run for a project from Supabase.
 *
 * @param {string} projectName
 * @returns {Promise<object|null>}
 */
export async function getLastRun(projectName) {
  return safeExec(
    async () => {
      const { data: sub, error: subErr } = await supabase
        .from("submissions")
        .select("id, project_name, success, attempts, total_ms, created_at")
        .eq("project_name", projectName)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (subErr || !sub) return null;

      const { data: res } = await supabase
        .from("results")
        .select("root_cause, patches, verification_passed, verification_stdout")
        .eq("submission_id", sub.id)
        .single();

      return {
        id: sub.id,
        success: sub.success,
        attempts: sub.attempts,
        totalMs: sub.total_ms,
        createdAt: sub.created_at,
        diagnosis: {
          rootCause: res?.root_cause ?? null,
          evidence: [],
          confidence: null,
        },
        fix: {
          patches: res?.patches ?? [],
          rationale: null,
        },
        verification: {
          passed: res?.verification_passed ?? null,
          stdout: res?.verification_stdout ?? "",
          stderr: "",
        },
        timeline: [],
      };
    },
    null,
    "getLastRun"
  );
}

/**
 * Fetch recent pipeline runs with pagination.
 *
 * @param {object} params
 * @param {number} [params.limit=20] - Max items to return
 * @param {number} [params.offset=0] - Items to skip
 * @returns {Promise<{ runs: object[], total: number }>}
 */
export async function getRunHistory({ limit = 20, offset = 0 } = {}) {
  return safeExec(
    async () => {
      const { data, error, count } = await supabase
        .from("submissions")
        .select("id, project_name, success, attempts, total_ms, created_at", {
          count: "exact",
        })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error || !data) return { runs: [], total: 0 };

      return {
        runs: data.map((sub) => ({
          id: sub.id,
          projectName: sub.project_name,
          success: sub.success,
          attempts: sub.attempts,
          totalMs: sub.total_ms,
          createdAt: sub.created_at,
        })),
        total: count ?? data.length,
      };
    },
    { runs: [], total: 0 },
    "getRunHistory"
  );
}
