"use client";
import { useEffect, useState, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

// ── Step metadata ─────────────────────────────────────────────────────────────
const STEP_META = {
  clone:    { label: "Clone Repo",  desc: "Fetching repository" },
  diagnose: { label: "Diagnose",    desc: "Root-cause analysis" },
  fix:      { label: "Fix",         desc: "Generating patch" },
  verify:   { label: "Verify",      desc: "Running test suite" },
};

function StepIcon({ status }) {
  if (status === "working") return (
    <svg style={{ width: 18, height: 18, animation: "spin 1s linear infinite", color: "#60a5fa" }} fill="none" viewBox="0 0 24 24">
      <circle opacity=".25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path opacity=".75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
    </svg>
  );
  if (status === "done") return (
    <svg style={{ width: 18, height: 18, color: "#4ade80" }} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
  if (status === "failed") return (
    <svg style={{ width: 18, height: 18, color: "#f87171" }} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
  if (status === "retry") return (
    <svg style={{ width: 18, height: 18, color: "#facc15", animation: "spin 1s linear infinite" }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
  );
  return <div style={{ width: 18, height: 18, borderRadius: "50%", border: "2px solid #1e2d50" }} />;
}

function AgentMessage({ text, type }) {
  const colorMap = {
    info:    "#b0bdd8",
    success: "#4ade80",
    error:   "#f87171",
    warn:    "#facc15",
  };
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
      <div style={{
        flexShrink: 0, width: 28, height: 28, borderRadius: 12,
        background: "linear-gradient(135deg, #1067ff, #7c3aed)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "0.7rem", fontWeight: 700, color: "white",
      }}>A</div>
      <div style={{
        background: "#0d1425",
        border: "1px solid #1e2d50",
        borderRadius: "16px 16px 16px 4px",
        padding: "0.6rem 1rem",
        fontSize: "0.8rem",
        fontFamily: "monospace",
        color: colorMap[type] || colorMap.info,
        maxWidth: 520,
        wordBreak: "break-word",
      }}>
        {text}
      </div>
    </div>
  );
}

function PipelineInner() {
  const params    = useSearchParams();
  const router    = useRouter();
  const project   = params.get("project");
  const githubUrl = params.get("githubUrl");
  const uploadId  = params.get("uploadId");

  const label = githubUrl
    ? githubUrl.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "")
    : uploadId ? "Uploaded files" : project;

  const STEPS = githubUrl ? ["clone", "diagnose", "fix", "verify"] : ["diagnose", "fix", "verify"];
  const initSteps = Object.fromEntries(STEPS.map((s) => [s, { status: "idle", attempt: 1, payload: null }]));

  const [steps, setSteps]       = useState(initSteps);
  const [attempt, setAttempt]   = useState(1);
  const [messages, setMessages] = useState([{ text: `Starting pipeline for "${label}"…`, type: "info" }]);
  const [result, setResult]     = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  // Guard against React StrictMode double-mount consuming the uploadId twice
  const hasRunRef = useRef(false);

  const messagesEnd = useRef(null);

  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function addMsg(text, type = "info") { setMessages((p) => [...p, { text, type }]); }
  function updStep(name, patch) { setSteps((p) => ({ ...p, [name]: { ...(p[name] || {}), ...patch } })); }

  useEffect(() => {
    if (!project && !githubUrl && !uploadId) return;
    if (hasRunRef.current) return;
    hasRunRef.current = true;

    let cancelled = false;
    const body = githubUrl ? { githubUrl } : uploadId ? { uploadId } : { projectName: project };
    const ctrl = new AbortController();

    const MAX_RETRIES = 3;
    let retryCount = 0;

    function startStream() {
      fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      }).then((res) => {
        if (!res.ok) {
          return res.json().then((err) => {
            setErrorMsg(err.error || `Server error: ${res.status}`);
            addMsg(`Error: ${err.error || res.statusText}`, "error");
          });
        }

        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        function pump() {
          reader.read().then(({ done, value }) => {
            if (done || cancelled) return;
            buf += decoder.decode(value, { stream: true });
            const parts = buf.split("\n\n");
            buf = parts.pop();

            for (const part of parts) {
              const evLine   = part.match(/^event:\s*(.+)$/m);
              const dataLine = part.match(/^data:\s*(.+)$/ms);
              if (!evLine || !dataLine) continue;
              let data;
              try { data = JSON.parse(dataLine[1]); } catch { continue; }

              const ev = evLine[1].trim();

              // Silently ignore heartbeat events (keep-alive pings)
              if (ev === "heartbeat") continue;

              if (ev === "step") {
                const { step, status, attempt: att, payload, message } = data;
                updStep(step, { status, attempt: att ?? 1, payload: payload ?? null });
                if (att && att > 1) setAttempt(att);
                const msg  = message || `[${step}] ${status}${att > 1 ? ` (attempt ${att})` : ""}`;
                const type = status === "done" ? "success" : status === "failed" ? "error" : status === "retry" ? "warn" : "info";
                addMsg(msg, type);
              } else if (ev === "done") {
                setResult(data);
                addMsg(
                  data.success
                    ? `✓ Pipeline complete — fixed in ${(data.totalMs / 1000).toFixed(1)}s!`
                    : "✗ Max retries reached without a passing test suite.",
                  data.success ? "success" : "error"
                );
              } else if (ev === "error") {
                setErrorMsg(data.message);
                addMsg(`Error: ${data.message}`, "error");
              }
            }
            pump();
          }).catch(() => {});
        }
        pump();
      }).catch((e) => {
        if (cancelled) return;
        // Retry with exponential backoff on network failure
        if (retryCount < MAX_RETRIES && !ctrl.signal.aborted) {
          retryCount++;
          const delayMs = Math.min(1000 * Math.pow(2, retryCount - 1), 8000);
          addMsg(`Network error, retrying in ${delayMs / 1000}s… (attempt ${retryCount}/${MAX_RETRIES})`, "warn");
          setTimeout(() => {
            if (!cancelled) startStream();
          }, delayMs);
        } else {
          setErrorMsg(String(e));
          addMsg(`Error: ${e}`, "error");
        }
      });
    }

    startStream();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [project, githubUrl, uploadId]);

  function stepStyle(status) {
    if (status === "working") return { border: "1px solid rgba(96,165,250,0.5)", background: "rgba(96,165,250,0.08)" };
    if (status === "done")    return { border: "1px solid rgba(74,222,128,0.5)", background: "rgba(74,222,128,0.08)" };
    if (status === "failed")  return { border: "1px solid rgba(248,113,113,0.5)", background: "rgba(248,113,113,0.08)" };
    if (status === "retry")   return { border: "1px solid rgba(250,204,21,0.5)",  background: "rgba(250,204,21,0.08)" };
    return { border: "1px solid #1e2d50", background: "#0d1425" };
  }

  return (
    <div style={{ minHeight: "100vh", background: "#020817", display: "flex", flexDirection: "column" }}>
      <header style={{
        height: 52, borderBottom: "1px solid #1a2d55",
        background: "rgba(2,8,23,0.85)", backdropFilter: "blur(12px)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 1.5rem", position: "sticky", top: 0, zIndex: 50,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: result ? (result.success ? "#4ade80" : "#f87171") : "#60a5fa",
          }} />
          <span style={{ color: "white", fontSize: "0.875rem", fontWeight: 600 }}>{label}</span>
          <span style={{ color: "#3d5080", fontSize: "0.75rem" }}>· Attempt {attempt} / 3</span>
        </div>
        <button
          onClick={() => router.push("/")}
          style={{ background: "none", border: "1px solid #1a2d55", color: "#5a7499", padding: "0.35rem 0.85rem", borderRadius: 8, fontSize: "0.78rem", cursor: "pointer" }}
        >
          ← Home
        </button>
      </header>

      <div style={{ borderBottom: "1px solid #1a2d55", padding: "1.25rem 1.5rem", background: "#071030", overflowX: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 0, minWidth: "fit-content" }}>
          {STEPS.map((name, i) => {
            const meta   = STEP_META[name] || { label: name, desc: "" };
            const status = steps[name]?.status || "idle";
            const att    = steps[name]?.attempt || 1;
            return (
              <div key={name} style={{ display: "flex", alignItems: "center" }}>
                <div style={{ borderRadius: 16, padding: "0.75rem 1rem", minWidth: 140, transition: "all 0.4s", ...stepStyle(status) }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.4rem" }}>
                    <StepIcon status={status} />
                    <div>
                      <div style={{ color: "white", fontWeight: 600, fontSize: "0.85rem" }}>{meta.label}</div>
                      <div style={{ color: "#6b7fa8", fontSize: "0.7rem" }}>{meta.desc}</div>
                    </div>
                  </div>
                  {att > 1 && <div style={{ fontSize: "0.68rem", color: "#facc15" }}>Attempt {att}</div>}
                  {status === "working" && (
                    <div style={{ position: "relative", height: 3, borderRadius: 3, background: "#1e2d50", overflow: "hidden", marginTop: 8 }}>
                      <div style={{ height: "100%", width: "60%", background: "linear-gradient(90deg, #1067ff, #7c3aed)", borderRadius: 3 }} />
                    </div>
                  )}
                </div>
                {i < STEPS.length - 1 && (
                  <div style={{ padding: "0 6px" }}>
                    <svg width="24" height="12" viewBox="0 0 24 12" fill="none">
                      <path d="M0 6H18M18 6L13 1M18 6L13 11"
                        stroke={steps[STEPS[i+1]]?.status !== "idle" ? "#1067ff" : "#1e2d50"}
                        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {messages.map((m, i) => <AgentMessage key={i} text={m.text} type={m.type} />)}
        <div ref={messagesEnd} />
      </div>

      {result && (
        <div style={{
          margin: "0 1.5rem 1rem",
          borderRadius: 16, padding: "1.1rem 1.25rem",
          border: result.success ? "1px solid rgba(74,222,128,0.4)" : "1px solid rgba(248,113,113,0.4)",
          background: result.success ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem",
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: "1.05rem", color: result.success ? "#4ade80" : "#f87171" }}>
              {result.success ? "✓ Bug Fixed & Verified" : "✗ Could Not Fix in 3 Attempts"}
            </div>
            <div style={{ color: "#6b7fa8", fontSize: "0.8rem", marginTop: 2 }}>
              {result.attempts} attempt{result.attempts > 1 ? "s" : ""} · {(result.totalMs / 1000).toFixed(1)}s
            </div>
          </div>
          <button
            onClick={() => router.push(`/report?project=${encodeURIComponent(result.projectLabel || label)}`)}
            style={{
              background: "linear-gradient(135deg, #1067ff, #7c3aed)",
              color: "white", border: "none",
              padding: "0.6rem 1.25rem", borderRadius: 10,
              fontWeight: 700, fontSize: "0.85rem", cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            View Report →
          </button>
        </div>
      )}

      {errorMsg && (
        <div style={{
          margin: "0 1.5rem 1rem", borderRadius: 16, padding: "1rem 1.25rem",
          border: "1px solid rgba(248,113,113,0.4)", background: "rgba(248,113,113,0.08)",
        }}>
          <div style={{ color: "#f87171", fontWeight: 600 }}>Pipeline Error</div>
          <div style={{ color: "#8899bb", fontSize: "0.85rem", marginTop: 4 }}>{errorMsg}</div>
        </div>
      )}

      <div style={{ borderTop: "1px solid #1a2d55", padding: "0.6rem 1.5rem" }}>
        <p style={{ color: "#33517a", fontSize: "0.72rem" }}>AutoFix AI · IBM Bob 2.0 · Real-time SSE pipeline</p>
      </div>
    </div>
  );
}

export default function Pipeline() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", background: "#020817", display: "flex", alignItems: "center", justifyContent: "center", color: "#5a7499" }}>
        Loading…
      </div>
    }>
      <PipelineInner />
    </Suspense>
  );
}
