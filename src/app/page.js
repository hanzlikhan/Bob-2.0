"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

export default function Landing() {
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState("");
  const [repoUrl, setRepoUrl]   = useState("");
  const [mode, setMode]         = useState("pick"); // pick | clone | upload
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState(null);
  const fileInputRef            = useRef(null);
  const router                  = useRouter();

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        const raw = d.projects || [];
        setProjects(raw);
        if (raw.length) {
          const first = typeof raw[0] === "object" ? raw[0].name : raw[0];
          setSelected(first);
        }
      })
      .catch(() => {});
  }, []);

  const runPick = () => {
    if (!selected) return;
    const name = typeof selected === "object" ? selected.name : selected;
    router.push(`/pipeline?project=${encodeURIComponent(name)}`);
  };

  const runClone = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Clone failed");
      router.push(`/pipeline?project=${encodeURIComponent(data.projectName)}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const runUpload = async () => {
    setError(null);
    const files = fileInputRef.current?.files;
    if (!files || files.length === 0) {
      setError("Choose at least one file");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      router.push(`/pipeline?uploadId=${encodeURIComponent(data.uploadId)}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const TABS = [
    { id: "pick",   icon: "◈",  label: "Sample Project" },
    { id: "clone",  icon: "◇",  label: "GitHub URL" },
    { id: "upload", icon: "◆",  label: "Upload Files" },
  ];

  return (
    <main style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "2rem 1rem",
      background: "radial-gradient(circle at 50% 0%, rgba(16,103,255,0.08), transparent 60%), var(--bg-deep)",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Subtle grid background */}
      <div aria-hidden style={{
        position: "absolute", inset: 0,
        backgroundImage: "linear-gradient(rgba(26,45,85,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(26,45,85,0.18) 1px, transparent 1px)",
        backgroundSize: "48px 48px",
        maskImage: "radial-gradient(circle at 50% 40%, black, transparent 70%)",
        WebkitMaskImage: "radial-gradient(circle at 50% 40%, black, transparent 70%)",
        pointerEvents: "none",
      }} />

      {/* Content */}
      <div style={{
        position: "relative",
        zIndex: 1,
        width: "100%",
        maxWidth: 960,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "2.5rem",
      }}>

        {/* Logo + title block */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.25rem" }} className="anim-scale-in">
          <Image
            src="/logo.png"
            alt="AutoFix AI"
            width={140}
            height={140}
            priority
            className="anim-logo-glow anim-float"
            style={{ objectFit: "contain" }}
          />
          <h1
            className="gradient-text"
            style={{
              fontSize: "clamp(2.5rem, 6vw, 4.25rem)",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
              margin: 0,
              textAlign: "center",
            }}
          >
            Self-Healing Debug Agent
          </h1>
          <p style={{
            color: "var(--text-muted)",
            fontSize: "clamp(1rem, 1.6vw, 1.2rem)",
            textAlign: "center",
            maxWidth: 640,
            margin: 0,
            lineHeight: 1.55,
          }}>
            Broken code goes in. Fixed, verified code comes out.<br />
            Powered by IBM Bob. Autonomous. Real tests. Real fixes.
          </p>
        </div>

        {/* Three step pills */}
        <div
          className="anim-fade-up delay-200"
          style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", justifyContent: "center" }}
        >
          {["Diagnose", "Fix", "Verify"].map((s, i) => (
            <span key={s} style={{
              padding: "0.4rem 0.9rem",
              borderRadius: 999,
              fontSize: "0.78rem",
              fontWeight: 600,
              letterSpacing: "0.04em",
              color: "var(--text-muted)",
              border: "1px solid var(--border)",
              background: "rgba(13,20,37,0.7)",
              display: "inline-flex", alignItems: "center", gap: "0.5rem",
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "linear-gradient(135deg, var(--brand-1), var(--brand-2))" }} />
              {s}
            </span>
          ))}
        </div>

        {/* Main card */}
        <div
          className="anim-fade-up delay-300"
          style={{
            width: "100%",
            maxWidth: 620,
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: 24,
            padding: "1.75rem",
            boxShadow: "0 24px 60px -20px rgba(16,103,255,0.25), 0 0 0 1px rgba(255,255,255,0.02)",
            display: "flex",
            flexDirection: "column",
            gap: "1.25rem",
          }}
        >
          {/* Tab row */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "0.5rem",
            background: "var(--bg-deep)",
            padding: "0.4rem",
            borderRadius: 14,
            border: "1px solid var(--border)",
          }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => { setMode(t.id); setError(null); }}
                style={{
                  border: "none",
                  padding: "0.65rem 0.5rem",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem",
                  transition: "all 0.25s",
                  color: mode === t.id ? "white" : "var(--text-dim)",
                  background: mode === t.id
                    ? "linear-gradient(135deg, var(--brand-1), var(--brand-2))"
                    : "transparent",
                  boxShadow: mode === t.id ? "0 4px 16px rgba(16,103,255,0.35)" : "none",
                }}
              >
                <span style={{ fontSize: "0.9rem" }}>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>

          {/* Panel body */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", minHeight: 200 }}>

            {mode === "pick" && (
              <>
                <label style={{ fontSize: "0.75rem", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                  Choose a broken project
                </label>
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  style={{
                    background: "var(--bg-deep)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    padding: "0.85rem 1rem",
                    borderRadius: 12,
                    fontSize: "0.9rem",
                    fontFamily: "monospace",
                    outline: "none",
                  }}
                >
                  {projects.length === 0 && <option>(no projects found)</option>}
                  {projects.map((p, idx) => {
                    const name = typeof p === "object" ? p.name : p;
                    const lang = typeof p === "object" && p.language ? ` (${p.language})` : "";
                    return (
                      <option key={name || idx} value={name}>
                        {name}{lang}
                      </option>
                    );
                  })}
                </select>
                <button
                  disabled={!selected || busy}
                  onClick={runPick}
                  style={{
                    marginTop: "auto",
                    padding: "0.9rem",
                    border: "none",
                    borderRadius: 12,
                    background: "linear-gradient(135deg, var(--brand-1), var(--brand-2))",
                    color: "white",
                    fontSize: "0.95rem",
                    fontWeight: 700,
                    cursor: !selected || busy ? "not-allowed" : "pointer",
                    opacity: !selected || busy ? 0.5 : 1,
                    boxShadow: "0 8px 24px rgba(16,103,255,0.3)",
                    transition: "transform 0.15s",
                  }}
                  onMouseDown={(e) => e.currentTarget.style.transform = "scale(0.98)"}
                  onMouseUp={(e) => e.currentTarget.style.transform = "scale(1)"}
                >
                  Run Agent Pipeline →
                </button>
              </>
            )}

            {mode === "clone" && (
              <>
                <label style={{ fontSize: "0.75rem", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                  Public GitHub URL
                </label>
                <input
                  placeholder="https://github.com/user/repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  style={{
                    background: "var(--bg-deep)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    padding: "0.85rem 1rem",
                    borderRadius: 12,
                    fontSize: "0.85rem",
                    fontFamily: "monospace",
                    outline: "none",
                  }}
                />
                <button
                  disabled={!repoUrl || busy}
                  onClick={runClone}
                  style={{
                    marginTop: "auto",
                    padding: "0.9rem",
                    border: "none",
                    borderRadius: 12,
                    background: "linear-gradient(135deg, var(--brand-1), var(--brand-2))",
                    color: "white",
                    fontSize: "0.95rem",
                    fontWeight: 700,
                    cursor: !repoUrl || busy ? "not-allowed" : "pointer",
                    opacity: !repoUrl || busy ? 0.5 : 1,
                    boxShadow: "0 8px 24px rgba(16,103,255,0.3)",
                  }}
                >
                  {busy ? "Cloning…" : "Clone & Run →"}
                </button>
                <p style={{ fontSize: "0.7rem", color: "var(--text-dim)", margin: 0 }}>
                  Local only — Vercel blocks git clone.
                </p>
              </>
            )}

            {mode === "upload" && (
              <>
                <label style={{ fontSize: "0.75rem", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                  Source files
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{
                    background: "var(--bg-deep)",
                    border: "1px dashed var(--border)",
                    color: "var(--text-muted)",
                    padding: "1.25rem",
                    borderRadius: 12,
                    fontSize: "0.8rem",
                    cursor: "pointer",
                  }}
                />
                <button
                  disabled={busy}
                  onClick={runUpload}
                  style={{
                    marginTop: "auto",
                    padding: "0.9rem",
                    border: "none",
                    borderRadius: 12,
                    background: "linear-gradient(135deg, var(--brand-1), var(--brand-2))",
                    color: "white",
                    fontSize: "0.95rem",
                    fontWeight: 700,
                    cursor: busy ? "not-allowed" : "pointer",
                    opacity: busy ? 0.5 : 1,
                    boxShadow: "0 8px 24px rgba(16,103,255,0.3)",
                  }}
                >
                  {busy ? "Uploading…" : "Upload & Run →"}
                </button>
                <p style={{ fontSize: "0.7rem", color: "var(--text-dim)", margin: 0 }}>
                  Include <code style={{ color: "var(--text-muted)" }}>error.log</code> to give Bob context.
                </p>
              </>
            )}

            {error && (
              <p className="anim-fade-in" style={{ color: "#f87171", fontSize: "0.82rem", margin: 0 }}>
                {error}
              </p>
            )}
          </div>
        </div>

        {/* Footer tag */}
        <p
          className="anim-fade-in delay-500"
          style={{ fontSize: "0.72rem", color: "var(--text-dim)", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, margin: 0 }}
        >
          Diagnose · Fix · Verify · Retry
        </p>
      </div>
    </main>
  );
}
