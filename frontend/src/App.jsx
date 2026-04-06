import { useState, useRef, useCallback } from "react";

// ── Constants ───────────────────────────────────────────────────────────────

const VERDICT_META = {
  "LIKELY TRUE":    { icon: "✓", color: "var(--true)",  bg: "var(--true-bg)",  border: "var(--true)"  },
  "LIKELY FALSE":   { icon: "✗", color: "var(--false)", bg: "var(--false-bg)", border: "var(--false)" },
  "MISLEADING":     { icon: "!", color: "var(--warn)",  bg: "var(--warn-bg)",  border: "var(--warn)"  },
  "PARTIALLY TRUE": { icon: "≈", color: "var(--warn)",  bg: "var(--warn-bg)",  border: "var(--warn)"  },
  "NEEDS CONTEXT":  { icon: "?", color: "var(--warn)",  bg: "var(--warn-bg)",  border: "var(--warn)"  },
  "UNVERIFIED":     { icon: "○", color: "var(--muted)", bg: "var(--surface)",  border: "var(--border)" },
  "SATIRE":         { icon: "~", color: "var(--muted)", bg: "var(--surface)",  border: "var(--border)" },
};

const BIAS_META = {
  political:         { label: "Political Lean",      color: "#8B7BB5" },
  emotional:         { label: "Emotional Language",  color: "#C97C5D" },
  sensationalism:    { label: "Sensationalism",      color: "#B36A5E" },
  factuality:        { label: "Factuality",          color: "#8FAF9A" },
  sourceCredibility: { label: "Source Trust",        color: "#6B9AB8" },
};

const TABS = [
  { id: "text",    icon: "📝", label: "Text" },
  { id: "image",   icon: "🖼",  label: "Image" },
  { id: "video",   icon: "🎬", label: "Video" },
  { id: "article", icon: "📄", label: "Full Article" },
];

const LANGUAGES = [
  ["auto","🌐 Auto-detect"],["en","🇺🇸 English"],["hi","🇮🇳 Hindi"],
  ["ta","🇮🇳 Tamil"],["te","🇮🇳 Telugu"],["es","🇪🇸 Spanish"],
  ["fr","🇫🇷 French"],["ar","🇸🇦 Arabic"],["zh","🇨🇳 Chinese"],
  ["de","🇩🇪 German"],["ja","🇯🇵 Japanese"],["ru","🇷🇺 Russian"],
  ["pt","🇧🇷 Portuguese"],
];

// ── API helpers ─────────────────────────────────────────────────────────────

async function analyzeText(text, lang) {
  const res = await fetch("/api/analyze/text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, lang }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Analysis failed");
  return data;
}

async function analyzeImage(file, context) {
  const fd = new FormData();
  fd.append("image", file);
  fd.append("context", context);
  const res = await fetch("/api/analyze/image", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Analysis failed");
  return data;
}

async function analyzeVideo(file, context) {
  if (file.size > 20 * 1024 * 1024) {
    throw new Error("Video is too large. Please upload a video under 20MB or shorter than 30 seconds.");
  }
  const fd = new FormData();
  fd.append("video", file);
  fd.append("context", context);
  const res = await fetch("/api/analyze/video", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Analysis failed");
  return data;
}
async function analyzeVideoUrl(url, context) {
  const res = await fetch("/api/analyze/video-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, context }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Analysis failed");
  return data;
}
// ── Sub-components ──────────────────────────────────────────────────────────

function Card({ children, className = "", style = {} }) {
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius)",
      padding: "22px 24px",
      boxShadow: "var(--shadow)",
      marginBottom: 18,
      ...style,
    }} className={className}>
      {children}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <p style={{
      fontSize: "0.64rem",
      textTransform: "uppercase",
      letterSpacing: "2.5px",
      color: "var(--muted)",
      marginBottom: 14,
      fontWeight: 600,
    }}>{children}</p>
  );
}

function Textarea({ value, onChange, placeholder, rows = 6 }) {
  return (
    <textarea
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      style={{
        width: "100%",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 9,
        color: "var(--text)",
        fontSize: "0.88rem",
        padding: "13px 15px",
        resize: "vertical",
        lineHeight: 1.75,
      }}
    />
  );
}

function AnalyzeBtn({ loading, onClick, label = "Analyse for Truth" }) {
  return (
    <button
      disabled={loading}
      onClick={onClick}
      style={{
        width: "100%",
        padding: "14px 0",
        background: loading ? "var(--surface2)" : "var(--accent)",
        border: "none",
        borderRadius: 10,
        color: loading ? "var(--muted)" : "#fff",
        fontFamily: "'Playfair Display', serif",
        fontSize: "1rem",
        fontWeight: 700,
        letterSpacing: "0.5px",
        cursor: loading ? "not-allowed" : "pointer",
        transition: "background 0.2s, transform 0.1s",
        boxShadow: loading ? "none" : "0 2px 8px rgba(201,124,93,0.35)",
      }}
      onMouseEnter={e => { if (!loading) e.target.style.background = "var(--accent-h)"; }}
      onMouseLeave={e => { if (!loading) e.target.style.background = "var(--accent)"; }}
    >
      {loading ? "Analysing…" : `🔍 ${label}`}
    </button>
  );
}

function FileDropZone({ accept, icon, label, subLabel, file, preview, onFile }) {
  const ref = useRef();
  const [drag, setDrag] = useState(false);

  const handle = f => { if (f) onFile(f); };
  const onDrop = e => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files[0]); };

  return (
    <div
      onClick={() => ref.current.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      style={{
        border: `2px dashed ${drag || file ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 10,
        padding: "32px 20px",
        textAlign: "center",
        cursor: "pointer",
        background: drag ? "rgba(201,124,93,0.05)" : "var(--bg)",
        transition: "border-color 0.2s, background 0.2s",
        marginBottom: 16,
      }}
    >
      <input ref={ref} type="file" accept={accept} onChange={e => handle(e.target.files[0])} style={{ display: "none" }} />
      {preview
        ? <img src={preview} alt="preview" style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 8, marginBottom: 8 }} />
        : <div style={{ fontSize: "2rem", marginBottom: 8 }}>{icon}</div>}
      <div style={{ color: file ? "var(--accent)" : "var(--muted)", fontSize: "0.82rem" }}>
        {file ? file.name : label}
      </div>
      {!file && <div style={{ color: "var(--muted)", fontSize: "0.72rem", marginTop: 4 }}>{subLabel}</div>}
    </div>
  );
}

function LoadingPanel({ status, steps, activeSteps }) {
  return (
    <div style={{ textAlign: "center", padding: "44px 20px" }}>
      <div style={{
        width: 44, height: 44, borderRadius: "50%",
        border: "3px solid var(--border)", borderTopColor: "var(--accent)",
        animation: "spin 0.85s linear infinite", margin: "0 auto 18px",
      }} />
      <div style={{ fontFamily: "'Playfair Display', serif", fontSize: "1rem", color: "var(--text)", marginBottom: 6 }}>
        Analysing…
      </div>
      {status && (
        <div style={{ fontSize: "0.76rem", color: "var(--accent)", marginBottom: 14, animation: "pulse 1.5s ease infinite" }}>
          {status}
        </div>
      )}
      <div>
        {steps.map((s, i) => (
          <div key={i} style={{
            fontSize: "0.72rem",
            color: activeSteps.includes(i) ? "var(--accent)" : "var(--border)",
            margin: "4px 0", transition: "color 0.4s",
          }}>
            {activeSteps.includes(i) ? "→ " : "   "}{s}
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorPanel({ message, onRetry }) {
  return (
    <div style={{
      background: "var(--false-bg)", border: "1px solid var(--false)", borderRadius: 10,
      padding: "14px 18px", marginTop: 14, display: "flex", alignItems: "center",
      justifyContent: "space-between", gap: 12, fontSize: "0.82rem", color: "var(--false)",
    }}>
      <span>⚠ {message}</span>
      <button onClick={onRetry} style={{
        background: "rgba(179,106,94,0.15)", border: "1px solid var(--false)", borderRadius: 6,
        color: "var(--false)", padding: "5px 13px", fontSize: "0.74rem",
        fontFamily: "'Inter', sans-serif", cursor: "pointer",
      }}>↺ Retry</button>
    </div>
  );
}

// ── Results ─────────────────────────────────────────────────────────────────

function VerdictBanner({ result }) {
  const vm = VERDICT_META[result.verdict] || VERDICT_META["UNVERIFIED"];
  const score = result.truthScore || 0;

  return (
    <div className="fade-up" style={{
      background: vm.bg, border: `1px solid ${vm.border}`, borderRadius: "var(--radius)",
      padding: "24px 28px", marginBottom: 18, display: "flex", alignItems: "center", gap: 20,
    }}>
      <div style={{
        width: 54, height: 54, borderRadius: "50%", background: vm.border + "22",
        border: `2px solid ${vm.border}`, display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: "1.5rem", fontWeight: 800, color: vm.color,
        fontFamily: "'Playfair Display', serif", flexShrink: 0,
      }}>
        {vm.icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: 3, color: "var(--muted)", marginBottom: 3 }}>
          Verdict
          {result.detectedLanguage && (
            <span style={{
              marginLeft: 10, background: "rgba(201,124,93,0.12)", border: "1px solid rgba(201,124,93,0.3)",
              color: "var(--accent)", borderRadius: 20, padding: "1px 9px", fontSize: "0.58rem",
            }}>
              {result.detectedLanguage}
            </span>
          )}
          {result.framesAnalyzed && (
            <span style={{
              marginLeft: 8, background: "rgba(107,154,184,0.12)", border: "1px solid rgba(107,154,184,0.3)",
              color: "#6B9AB8", borderRadius: 20, padding: "1px 9px", fontSize: "0.58rem",
            }}>
              🎬 {result.framesAnalyzed} frames
            </span>
          )}
        </div>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: "clamp(1.3rem,3.5vw,1.9rem)", fontWeight: 700, color: vm.color }}>
          {result.verdict}
        </div>
        <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginTop: 4 }}>{result.verdictSummary}</div>
      </div>
      <div style={{ textAlign: "center", flexShrink: 0 }}>
        <div style={{
          fontFamily: "'Playfair Display', serif", fontSize: "2.2rem", fontWeight: 700,
          color: score >= 70 ? "var(--true)" : score >= 40 ? "var(--warn)" : "var(--false)",
        }}>{score}</div>
        <div style={{ fontSize: "0.6rem", color: "var(--muted)", letterSpacing: 1 }}>/ 100</div>
      </div>
    </div>
  );
}

function TruthGauge({ result }) {
  const score = result.truthScore || 0;
  return (
    <Card className="fade-up-1">
      <SectionTitle>Truth Index</SectionTitle>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
        <span style={{ fontSize: "0.64rem", color: "var(--false)", width: 60 }}>Likely False</span>
        <div style={{
          flex: 1, height: 10, background: "var(--bg)", borderRadius: 5,
          overflow: "hidden", border: "1px solid var(--border)",
        }}>
          <div style={{
            height: "100%", width: `${score}%`,
            background: `linear-gradient(90deg, var(--false), var(--warn) 50%, var(--true))`,
            borderRadius: 5, transition: "width 1.2s cubic-bezier(0.22,1,0.36,1)",
          }} />
        </div>
        <span style={{ fontSize: "0.64rem", color: "var(--true)", width: 60, textAlign: "right" }}>Likely True</span>
      </div>
      <div style={{ fontSize: "0.76rem", color: "var(--muted)" }}>{result.scoreExplanation}</div>
    </Card>
  );
}

function BiasHeatmap({ result }) {
  return (
    <Card className="fade-up-2">
      <SectionTitle>Bias Heatmap</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
        {Object.entries(result.bias || {}).map(([key, val]) => {
          const meta = BIAS_META[key] || { label: key, color: "var(--muted)" };
          const display = key === "political" ? Math.abs(val - 50) * 2 : val;
          const tier = display < 30 ? "Low" : display < 60 ? "Moderate" : "High";
          return (
            <div key={key} style={{
              background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 9,
              padding: "12px 14px", textAlign: "center",
            }}>
              <div style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: 1, color: "var(--muted)", marginBottom: 8 }}>
                {meta.label}
              </div>
              <div style={{ height: 5, background: "var(--border)", borderRadius: 3, marginBottom: 8, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${display}%`, background: meta.color, borderRadius: 3 }} />
              </div>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: "1.05rem", fontWeight: 700, color: meta.color }}>
                {display}%
              </div>
              <div style={{ fontSize: "0.6rem", color: "var(--muted)", marginTop: 2 }}>{tier}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ClaimsPanel({ result }) {
  if (!result.claims?.length) return null;
  return (
    <Card className="fade-up-3">
      <SectionTitle>Key Claims</SectionTitle>
      {result.claims.map((cl, i) => {
        const clr = cl.status === "TRUE" ? "var(--true)" : cl.status === "FALSE" ? "var(--false)" : "var(--warn)";
        const bg  = cl.status === "TRUE" ? "var(--true-bg)" : cl.status === "FALSE" ? "var(--false-bg)" : "var(--warn-bg)";
        return (
          <div key={i} style={{
            display: "flex", alignItems: "flex-start", gap: 12,
            padding: "12px 0", borderBottom: i < result.claims.length - 1 ? "1px solid var(--border)" : "none",
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: "50%", background: bg,
              border: `1.5px solid ${clr}`, color: clr, display: "flex",
              alignItems: "center", justifyContent: "center", fontSize: "0.7rem",
              fontWeight: 700, flexShrink: 0, marginTop: 2,
            }}>
              {cl.status === "TRUE" ? "✓" : cl.status === "FALSE" ? "✗" : "?"}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.85rem", marginBottom: 3 }}>{cl.text}</div>
              <div style={{ color: "var(--muted)", fontSize: "0.78rem" }}>{cl.explanation}</div>
            </div>
          </div>
        );
      })}
    </Card>
  );
}

function BiasHighlight({ result }) {
  const text = result._orig || "";
  const highlights = result.biasHighlights || [];
  if (!text || !highlights.length) return null;

  // Build spans
  let parts = [{ t: text.slice(0, 900), cls: null }];
  for (const { phrase, type } of highlights) {
    const cls = type === "high" ? "bh" : type === "medium" ? "bm" : "bo";
    parts = parts.flatMap(p => {
      if (p.cls) return [p];
      const lo = p.t.toLowerCase(), ph = phrase.toLowerCase();
      const idx = lo.indexOf(ph);
      if (idx === -1) return [p];
      return [
        { t: p.t.slice(0, idx), cls: null },
        { t: p.t.slice(idx, idx + phrase.length), cls },
        { t: p.t.slice(idx + phrase.length), cls: null },
      ].filter(x => x.t);
    });
  }

  const bgMap  = { bh: "rgba(179,106,94,0.22)",  bm: "rgba(216,178,110,0.22)", bo: "rgba(139,123,181,0.18)" };
  const clrMap = { bh: "var(--false)",             bm: "#9A7A40",                bo: "#6B5B9A" };

  return (
    <Card className="fade-up-4">
      <SectionTitle>Bias Visualisation</SectionTitle>
      <div style={{ fontSize: "0.84rem", lineHeight: 2, marginBottom: 14 }}>
        {parts.map((p, i) => (
          <span key={i} style={p.cls ? { background: bgMap[p.cls], color: clrMap[p.cls], borderRadius: 3, padding: "1px 3px" } : {}}>
            {p.t}
          </span>
        ))}
        {text.length > 900 && <span style={{ color: "var(--muted)" }}> …</span>}
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {[["rgba(179,106,94,0.35)", "High Bias"], ["rgba(216,178,110,0.35)", "Moderate Bias"], ["rgba(139,123,181,0.3)", "Opinion / Speculation"]].map(([bg, lbl]) => (
          <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.68rem", color: "var(--muted)" }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: bg }} /> {lbl}
          </div>
        ))}
      </div>
    </Card>
  );
}

function AnalysisGrid({ result }) {
  const items = [
    ["🔎 Why this verdict?", result.whyVerdict],
    ["⚠ Red flags",          result.redFlags],
    ["✓ Credible elements",  result.credibleElements],
    ["📌 Recommendations",   result.recommendations],
  ];
  return (
    <div className="fade-up-5" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
      {items.map(([title, body]) => (
        <Card key={title} style={{ marginBottom: 0 }}>
          <SectionTitle>{title}</SectionTitle>
          <div style={{ fontSize: "0.82rem", lineHeight: 1.85, color: "var(--muted)", whiteSpace: "pre-line" }}>{body}</div>
        </Card>
      ))}
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────────

const STEPS = [
  "Detecting language & content type",
  "Cross-referencing claims",
  "Analysing bias patterns",
  "Computing truth index",
  "Generating detailed report",
];

export default function App() {
  const [tab, setTab]               = useState("text");
  const [newsText, setNewsText]     = useState("");
  const [articleText, setArtText]   = useState("");
  const [lang, setLang]             = useState("auto");
  const [imgFile, setImgFile]       = useState(null);
  const [imgPreview, setImgPreview] = useState(null);
  const [imgCtx, setImgCtx]         = useState("");
  const [vidFile, setVidFile]       = useState(null);
  const [vidCtx, setVidCtx]         = useState("");
  const [busy, setBusy]             = useState(false);
  const [status, setStatus]         = useState("");
  const [activeSteps, setAS]        = useState([]);
  const [result, setResult]         = useState(null);
  const [err, setErr]               = useState(null);
  const lastRunRef = useRef(null);
  const [vidMode, setVidMode] = useState("url");
const [vidUrl, setVidUrl]   = useState("");

  const handleImgFile = f => {
    setImgFile(f);
    const r = new FileReader();
    r.onload = () => setImgPreview(r.result);
    r.readAsDataURL(f);
  };

  const go = useCallback(async (mode) => {
    lastRunRef.current = mode;
    setBusy(true); setResult(null); setErr(null); setAS([]); setStatus("");
    STEPS.forEach((_, i) => setTimeout(() => setAS(p => [...p, i]), i * 700));

    try {
      let data;
      if (mode === "text")    data = await analyzeText(newsText, lang);
      if (mode === "article") data = await analyzeText(articleText, lang);
      if (mode === "image")   data = await analyzeImage(imgFile, imgCtx);
      if (mode === "video")   data = await analyzeVideo(vidFile, vidCtx);

if (mode === "video-url") data = await analyzeVideoUrl(vidUrl, vidCtx); // ← ADD
      const origText = (mode === "text" ? newsText : mode === "article" ? articleText : "");
      setResult({ ...data, _orig: origText });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  },[newsText, articleText, lang, imgFile, imgCtx, vidFile, vidCtx, vidUrl]);

  const canRun = {
    text:    !!newsText.trim(),
    article: !!articleText.trim(),
    image:   !!imgFile,
    video:   !!vidFile,
    "video-url": !!vidUrl.trim(),
  };

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "0 18px 60px" }}>

      {/* Header */}
      <header style={{ textAlign: "center", padding: "52px 0 36px" }}>
        <h1 style={{ fontSize: "clamp(2rem,5vw,3rem)", fontWeight: 700, color: "var(--text)", letterSpacing: "-1px", marginBottom: 8 }}>
          Truth<span style={{ color: "var(--accent)" }}>Lens</span>
        </h1>
        <p style={{ color: "var(--muted)", fontSize: "0.8rem", letterSpacing: "3px", textTransform: "uppercase" }}>
          AI-Powered News Verification · Bias Detection · Multilingual
        </p>
      </header>

      {/* Tabs */}
      <div style={{
        display: "flex", gap: 4, background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 12, padding: 4, marginBottom: 22,
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setResult(null); setErr(null); }}
            style={{
              flex: 1, padding: "9px 6px",
              background: tab === t.id ? "var(--bg)" : "transparent",
              border: tab === t.id ? "1px solid var(--border)" : "1px solid transparent",
              borderRadius: 8, color: tab === t.id ? "var(--accent)" : "var(--muted)",
              fontSize: "0.73rem", fontWeight: 600, transition: "all 0.18s",
              boxShadow: tab === t.id ? "var(--shadow)" : "none",
            }}
          >
            <span style={{ marginRight: 5 }}>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* Language selector (text/article tabs) */}
      {(tab === "text" || tab === "article") && (
        <div style={{ marginBottom: 14 }}>
          <select value={lang} onChange={e => setLang(e.target.value)} style={{
            background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8,
            color: "var(--text)", padding: "7px 12px", fontSize: "0.82rem",
          }}>
            {LANGUAGES.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
          </select>
        </div>
      )}

      {/* ── Text Tab ── */}
      {tab === "text" && (
        <Card>
          <SectionTitle>News Headline or Short Text</SectionTitle>
          <Textarea
            value={newsText}
            onChange={e => setNewsText(e.target.value)}
            placeholder={"Paste any news headline, claim, or short text here…\n\nWorks in English, Hindi, Tamil, Spanish, French, Arabic, Chinese, and 50+ languages."}
          />
          <div style={{ marginTop: 14 }}>
            <AnalyzeBtn loading={busy} onClick={() => canRun.text && go("text")} />
          </div>
        </Card>
      )}

      {/* ── Image Tab ── */}
      {tab === "image" && (
        <Card>
          <SectionTitle>News Image or Screenshot</SectionTitle>
         
          <FileDropZone
            accept="image/*"
            icon="🖼"
            label="Click or drag to upload a news image / screenshot"
            subLabel="PNG, JPG, WebP — up to 20 MB"
            file={imgFile}
            preview={imgPreview}
            onFile={handleImgFile}
          />
          <Textarea
            value={imgCtx}
            onChange={e => setImgCtx(e.target.value)}
            placeholder="Optional: Add context about this image…"
            rows={3}
          />
          <div style={{ marginTop: 14 }}>
            <AnalyzeBtn loading={busy} onClick={() => canRun.image && go("image")} label="Analyse Image" />
          </div>
        </Card>
      )}

  {/* ── Video Tab ── */}
{tab === "video" && (
  <Card>
    <SectionTitle>News Video</SectionTitle>

    {/* Mode toggle */}
    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
      {["url", "upload"].map(m => (
        <button key={m} onClick={() => setVidMode(m)} style={{
          padding: "7px 18px",
          background: vidMode === m ? "var(--accent)" : "var(--surface2)",
          border: "none", borderRadius: 8,
          color: vidMode === m ? "#fff" : "var(--muted)",
          fontSize: "0.78rem", fontWeight: 600, cursor: "pointer",
        }}>
          {m === "url" ? "🔗 Paste URL" : "📁 Upload File"}
        </button>
      ))}
    </div>

    {vidMode === "url" ? (
      <>
        <input
          type="text"
          value={vidUrl}
          onChange={e => setVidUrl(e.target.value)}
          placeholder="Paste YouTube, news article, or any video URL here…"
          style={{
            width: "100%", background: "var(--bg)",
            border: "1px solid var(--border)", borderRadius: 9,
            color: "var(--text)", fontSize: "0.88rem",
            padding: "13px 15px", marginBottom: 12,
          }}
        />
        
      </>
    ) : (
      <>
        <div style={{
          background: "var(--warn-bg)", border: "1px solid var(--warn)",
          borderRadius: 9, padding: "10px 14px", marginBottom: 14,
          fontSize: "0.78rem", color: "var(--text)"
        }}>
          ⚠ <strong>🎙 How it works:</strong> Audio is extracted → transcribed → fact-checked by AI. Upload videos <strong>under 200MB.</strong>
        </div>
        <FileDropZone
          accept="video/*"
          icon="🎬"
          label="Click or drag to upload a news video"
          subLabel="MP4, WebM — up to 20MB · Keep under 30 seconds"
          file={vidFile}
          preview={null}
          onFile={setVidFile}
        />
      </>
    )}

    <Textarea
      value={vidCtx}
      onChange={e => setVidCtx(e.target.value)}
      placeholder="Optional: Add context about this video…"
      rows={3}
    />
    <div style={{ marginTop: 14 }}>
      <AnalyzeBtn
        loading={busy}
        onClick={() => {
          if (vidMode === "url" && vidUrl.trim()) go("video-url");
          else if (vidMode === "upload" && vidFile) go("video");
        }}
        label="Analyse Video"
      />
    </div>
  </Card>
)}
     

      {/* ── Article Tab ── */}
      {tab === "article" && (
        <Card>
          <SectionTitle>Full Article or Social Media Post</SectionTitle>
          <Textarea
            value={articleText}
            onChange={e => setArtText(e.target.value)}
            placeholder={"Paste the full article or social media post here…\n\nMore text = more accurate analysis."}
            rows={10}
          />
          <div style={{ marginTop: 14 }}>
            <AnalyzeBtn loading={busy} onClick={() => canRun.article && go("article")} label="Deep Analysis" />
          </div>
        </Card>
      )}

      {/* Loading */}
      {busy && (
        <LoadingPanel status={status} steps={STEPS} activeSteps={activeSteps} />
      )}

      {/* Error */}
      {err && !busy && (
        <ErrorPanel message={err} onRetry={() => lastRunRef.current && go(lastRunRef.current)} />
      )}

      {/* Results */}
      {result && !busy && (
        <div style={{ marginTop: 28 }}>
          <VerdictBanner result={result} />
          <TruthGauge result={result} />
          <BiasHeatmap result={result} />
          <ClaimsPanel result={result} />
          <BiasHighlight result={result} />
          <AnalysisGrid result={result} />
        </div>
      )}

      {/* Footer */}
      <footer style={{ textAlign: "center", marginTop: 52, color: "var(--muted)", fontSize: "0.72rem" }}>
        TruthLens uses proprietary multi-stage verification algorithm · Results are advisory, not definitive · Always verify with primary sources
      </footer>
    </div>
  );
}
