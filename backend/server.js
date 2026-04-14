const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const ffmpeg = require("fluent-ffmpeg");
const FormData = require("form-data");
require("dotenv").config();

const sharp = require("sharp");

// ── NewsAPI Key ────────────────────────────────────────
const NEWS_API_KEY = process.env.NEWSAPI_KEY;


// ── Helper: Run DistilBERT ML Model (HuggingFace Spaces) ──────────────────
async function runMLModel(text) {
  try {
    const response = await axios.post(
      "https://rajgeetesh1-truthverse-api.hf.space/predict",
      { text: text.slice(0, 512) },
      { headers: { "Content-Type": "application/json" }, timeout: 30000 }
    );
    return response.data;
  } catch (err) {
    console.log("ML API error:", err.message);
    return { ml_score: 50, ml_verdict: "UNVERIFIED", confidence: 0 };
  }
}

// ── Helper: NewsAPI Cross-Verification ────────────────
async function crossVerifyNews(text) {
  try {
    const keywords = text.slice(0, 100).replace(/[^a-zA-Z0-9 ]/g, "");
    const response = await axios.get("https://newsapi.org/v2/everything", {
      params: {
        q: keywords,
        apiKey: NEWS_API_KEY,
        pageSize: 5,
        language: "en",
        sortBy: "relevancy"
      }
    });
    const articles = response.data.articles || [];
    const source_score = articles.length > 0
      ? Math.min(articles.length * 20, 100)
      : 0;
    return {
      source_score,
      sources_found: articles.length,
      top_sources: articles.slice(0, 3).map(a => ({
        title:  a.title,
        source: a.source.name,
        url:    a.url
      }))
    };
  } catch {
    return { source_score: 50, sources_found: 0, top_sources: [] };
  }
}

// ── Helper: TruthVerse Credibility Algorithm ──────────
function calculateTruthScore(ml_score, source_score, groq_score) {
  return Math.round(
    (ml_score * 0.4) + (source_score * 0.4) + (groq_score * 0.2)
  );
}
const app = express();
const upload = multer({ dest: "uploads/", limits: { fileSize: 200 * 1024 * 1024 } });

app.use(cors({ origin: ["http://localhost:5173", "https://truthlens.vercel.app", "https://truthlens-sand.vercel.app"] }));
app.use(express.json({ limit: "200mb" }));

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

// ── API Keys ───────────────────────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const HIVE_API_KEY = process.env.HIVE_API_KEY;

// ── Groq System Prompt ─────────────────────────────────────────────────────
const GROQ_SYSTEM = `You are TruthLens, an expert AI news verification and fact-checking system.
Analyze news content for truthfulness, bias, and credibility.
ALWAYS respond with ONLY valid JSON. No markdown fences, no extra text.
{
  "verdict": "LIKELY TRUE" | "LIKELY FALSE" | "MISLEADING" | "PARTIALLY TRUE" | "UNVERIFIED" | "SATIRE" | "NEEDS CONTEXT",
  "truthScore": number (0-100),
  "detectedLanguage": string,
  "verdictSummary": string,
  "whyVerdict": string,
  "redFlags": string (bullet points with •),
  "credibleElements": string (bullet points with •),
  "recommendations": string (bullet points with •),
  "scoreExplanation": string,
  "bias": {
    "political": number (0-100),
    "emotional": number (0-100),
    "sensationalism": number (0-100),
    "factuality": number (0-100),
    "sourceCredibility": number (0-100)
  },
  "claims": [{ "text": string, "status": "TRUE"|"FALSE"|"UNVERIFIED", "explanation": string }],
  "biasHighlights": [{ "phrase": string, "type": "high"|"medium"|"opinion", "reason": string }]
}`;

// ── Helper: Call Groq (text) ───────────────────────────────────────────────
async function callGroq(userMessage, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 2048,
          temperature: 0.1,
          messages: [
            { role: "system", content: GROQ_SYSTEM },
            { role: "user", content: userMessage },
          ],
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        if ((response.status === 429 || response.status === 503) && i < retries - 1) {
          await new Promise(r => setTimeout(r, (i + 1) * 3000));
          continue;
        }
        throw new Error(data.error?.message || "Groq API error");
      }

      const raw = data.choices[0].message.content.trim();
      const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const jsonStart = clean.indexOf("{");
      const jsonEnd = clean.lastIndexOf("}");
      if (jsonStart === -1 || jsonEnd === -1) throw new Error("Invalid JSON from Groq");
      return JSON.parse(clean.slice(jsonStart, jsonEnd + 1));
    } catch (err) {
      if (err instanceof SyntaxError) throw new Error("Invalid AI response. Please retry.");
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// ── Helper: Extract audio from video using ffmpeg ─────────────────────────
function extractAudio(videoPath, audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .output(audioPath)
      .audioCodec("libmp3lame")
      .audioBitrate("64k")
      .audioChannels(1)
      .audioFrequency(16000)
      .noVideo()
      .on("end", () => {
        console.log("✅ Audio extracted successfully");
        resolve();
      })
      .on("error", (err) => {
        console.error("❌ ffmpeg error:", err.message);
        reject(err);
      })
      .run();
  });
}

// ── Helper: Transcribe audio using Groq Whisper (FREE) ────────────────────
async function transcribeAudio(audioPath) {
  console.log("🎙 Transcribing audio with Groq Whisper...");

  const audioBuffer = fs.readFileSync(audioPath);
  const formData = new FormData();

  formData.append("file", audioBuffer, {
    filename: "audio.mp3",
    contentType: "audio/mpeg",
    knownLength: audioBuffer.length,
  });
  formData.append("model", "whisper-large-v3");
  formData.append("response_format", "json");
  formData.append("language", "en");

  const response = await axios.post(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    formData,
    {
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        ...formData.getHeaders(),
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    }
  );

  const transcript = response.data?.text || "";
  console.log("✅ Transcription done:", transcript.slice(0, 100), "...");
  return transcript;
}

// ── Helper: Call Hive API (V3) for images ─────────────────────────────────
async function callHiveWithFile(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const base64Data = fileBuffer.toString("base64");

  console.log(`Calling Hive, file size: ${fileBuffer.length}`);

  try {
    const response = await axios.post(
      "https://api.thehive.ai/api/v3/hive/ai-generated-and-deepfake-content-detection",
      { input: [{ media_base64: base64Data }] },
      {
        headers: {
          Authorization: `Bearer ${HIVE_API_KEY}`,
          "Content-Type": "application/json",
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }
    );
    console.log(`Hive response (${response.status}):`, JSON.stringify(response.data).slice(0, 300));
    return response.data;
  } catch (err) {
    const errBody = JSON.stringify(err.response?.data || err.message);
    console.log(`Hive response (${err.response?.status}):`, errBody);
    throw new Error(`Hive API error: ${errBody}`);
  }
}

// ── Helper: Parse Hive Result (V3) ────────────────────────────────────────
function parseHiveVisualResult(hiveData) {
  try {
    const classes = hiveData?.output?.[0]?.classes || [];
    const flags = {};
    classes.forEach(c => { flags[c.class] = c.value; });

    const aiScore       = flags["ai_generated"]    || 0;
    const deepfakeScore = flags["deepfake"]         || 0;
    const realScore     = flags["not_ai_generated"] || 0;

    return { flags, aiScore, deepfakeScore, realScore };
  } catch {
    return { flags: {}, aiScore: 0, deepfakeScore: 0, realScore: 0 };
  }
}

// ── Helper: Build image verdict from Hive + Groq ──────────────────────────
async function buildImageVerdict(hiveData, contextText) {
  const { aiScore, deepfakeScore, realScore, flags } = parseHiveVisualResult(hiveData);

  const hiveDesc = `
Hive AI Detection Results for a news image:
- AI Generated probability: ${(aiScore * 100).toFixed(1)}%
- Deepfake probability: ${(deepfakeScore * 100).toFixed(1)}%
- Real/Authentic probability: ${(realScore * 100).toFixed(1)}%
- All detected classes: ${JSON.stringify(flags, null, 2)}

User describes this image as: "${contextText || "No description provided"}"

Based on BOTH the Hive AI detection scores AND the user's description:
1. Determine if the image is AI-generated or manipulated
2. Fact-check the news claim described by the user
3. Give a combined verdict on authenticity and truthfulness`;

  const groqResult = await callGroq(hiveDesc);

  groqResult.hiveScores = {
    aiGenerated: (aiScore * 100).toFixed(1) + "%",
    deepfake:    (deepfakeScore * 100).toFixed(1) + "%",
    authentic:   (realScore * 100).toFixed(1) + "%",
  };

  return groqResult;
}

// ── Routes ─────────────────────────────────────────────────────────────────

// 1. Analyze Text
app.post("/api/analyze/text", async (req, res) => {
  try {
    const { text, lang } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: "No text provided" });

    console.log("📝 Running ML model...");
    const langNote = lang && lang !== "auto" ? ` (language hint: ${lang})` : "";

    // Run all 3 layers in parallel
    const [mlResult, newsResult, groqResult] = await Promise.all([
      runMLModel(text),
      crossVerifyNews(text),
      callGroq(`Analyze this news content${langNote}:\n\n${text}`)
    ]);

    // TruthVerse Credibility Algorithm
    const finalScore = calculateTruthScore(
      mlResult.ml_score    || 50,
      newsResult.source_score || 50,
      groqResult.truthScore   || 50
    );

    // Combine all results
    const result = {
      ...groqResult,
      truthScore: finalScore,
      mlAnalysis: {
        ml_score:   mlResult.ml_score,
        ml_verdict: mlResult.ml_verdict,
        confidence: mlResult.confidence
      },
      newsVerification: {
        sources_found: newsResult.sources_found,
        source_score:  newsResult.source_score,
        top_sources:   newsResult.top_sources
      },
      algorithmUsed: "TruthVerse Credibility Algorithm: (ML×0.4) + (NewsAPI×0.4) + (Groq×0.2)"
    };

    res.json(result);
  } catch (err) {
    console.error("Text error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2. Analyze Image — Hive AI Detection + Groq
app.post("/api/analyze/image", upload.single("image"), async (req, res) => {
  const filePath = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ error: "No image provided" });

    const context = req.body.context || "";
console.log("🖼 Analyzing image with Hive...");

const ext = path.extname(req.file.originalname).toLowerCase();

// Auto-convert WebP to JPG for Hive
let processedPath = filePath;
if (ext === ".webp" || ext === ".gif") {
  processedPath = filePath + ".jpg";
  await sharp(filePath).jpeg().toFile(processedPath);
  console.log("Converted WebP to JPG ✅");
}

const hiveSupported = [".jpg", ".jpeg", ".png", ".webp"].includes(ext);

const hiveData = hiveSupported 
  ? await callHiveWithFile(filePath).catch(e => {
      console.log("Hive ERROR:", e.message);
      return null;
    })
  : null;

    let result;
    if (hiveData) {
  result = await buildImageVerdict(hiveData, context);
} else {
  result = await callGroq(
    `Analyze this news image context for truthfulness:\n\n${context || "No context provided"}`
  );
}

// Add NewsAPI verification on image context
if (context) {
  const newsResult = await crossVerifyNews(context);
  result.newsVerification = {
    sources_found: newsResult.sources_found,
    source_score: newsResult.source_score,
    top_sources: newsResult.top_sources
  };
}

    
   try { if (processedPath !== filePath) fs.unlinkSync(processedPath); } catch {}
try { if (filePath) fs.unlinkSync(filePath); } catch {}
    res.json(result);
  
  } catch (err) {
    try { if (processedPath !== filePath) fs.unlinkSync(processedPath); } catch {}
try { if (filePath) fs.unlinkSync(filePath); } catch {}
    console.error("Image error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 3. Analyze Video — ffmpeg extract audio → Groq Whisper transcribe → Groq fact-check
app.post("/api/analyze/video", upload.single("video"), async (req, res) => {
  const filePath = req.file?.path;
  const audioPath = filePath ? `${filePath}.mp3` : null;

  try {
    if (!req.file) return res.status(400).json({ error: "No video provided" });

    const context = req.body.context || "";
    console.log("🎬 Processing video...");

    // Step 1: Extract audio from video
    console.log("🔊 Extracting audio from video...");
    await extractAudio(filePath, audioPath);

    // Step 2: Transcribe audio using Groq Whisper
    let transcript = "";
    try {
      transcript = await transcribeAudio(audioPath);
    } catch (transcribeErr) {
      console.log("Transcription error:", transcribeErr.message);
      transcript = "";
    }

    // Step 3: Fact-check the transcript with Groq
    const analysisPrompt = transcript
      ? `Analyze this news video transcript for truthfulness, bias and misinformation:

TRANSCRIPT:
"${transcript}"

${context ? `Additional context: ${context}` : ""}

Carefully fact-check every claim made in this transcript. Identify misleading statements, propaganda, or false information.`
      : `Analyze this news video for truthfulness based on context:
${context || "No transcript or context available — give UNVERIFIED verdict"}`;

   const [mlResult, newsResult, groqResult] = await Promise.all([
  transcript ? runMLModel(transcript) : Promise.resolve({ ml_score: 50, ml_verdict: "UNVERIFIED", confidence: 0 }),
  transcript ? crossVerifyNews(transcript) : Promise.resolve({ source_score: 50, sources_found: 0, top_sources: [] }),
  callGroq(analysisPrompt)
]);

const finalScore = calculateTruthScore(
  mlResult.ml_score || 50,
  newsResult.source_score || 50,
  groqResult.truthScore || 50
);

const result = {
  ...groqResult,
  truthScore: finalScore,
  mlAnalysis: {
    ml_score: mlResult.ml_score,
    ml_verdict: mlResult.ml_verdict,
    confidence: mlResult.confidence
  },
  newsVerification: {
    sources_found: newsResult.sources_found,
    source_score: newsResult.source_score,
    top_sources: newsResult.top_sources
  },
  algorithmUsed: "TruthVerse Credibility Algorithm: (ML×0.4) + (NewsAPI×0.4) + (Groq×0.2)"
};

if (transcript) result.transcript = transcript;

    // Cleanup files
    if (filePath) try { fs.unlinkSync(filePath); } catch {}
    if (audioPath) try { fs.unlinkSync(audioPath); } catch {}

    res.json(result);
  } catch (err) {
    if (filePath) try { fs.unlinkSync(filePath); } catch {}
    if (audioPath) try { fs.unlinkSync(audioPath); } catch {}
    console.error("Video error:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// 4. Analyze Video URL — yt-dlp download → Whisper transcribe → Groq fact-check
app.post("/api/analyze/video-url", async (req, res) => {
  const audioPath = path.join("uploads", `url_audio_${Date.now()}.mp3`);

  try {
    const { url, context } = req.body;
    if (!url?.trim()) return res.status(400).json({ error: "No URL provided" });

    console.log("🔗 Downloading audio from URL:", url);

    // Step 1: Download audio using yt-dlp
    await new Promise((resolve, reject) => {
      const ytdlp = spawn("yt-dlp", [
        "-x", "--audio-format", "mp3",
        "--audio-quality", "64K",
        "-o", audioPath.replace(".mp3", ".%(ext)s"),
        "--no-playlist",
        url
      ]);

      ytdlp.stdout.on("data", d => console.log(d.toString()));
      ytdlp.stderr.on("data", d => console.log(d.toString()));
      ytdlp.on("close", code => {
  if (code === 0) resolve();
  else reject(new Error("yt-dlp failed — video unavailable or restricted"));
});
    });

    // Step 2: Transcribe with Whisper
    console.log("🎙 Transcribing URL audio...");
    let transcript = "";
    try {
      transcript = await transcribeAudio(audioPath);
    } catch (e) {
      console.log("Transcription error:", e.message);
    }

    // Step 3: Analyze with Groq
    const analysisPrompt = transcript
      ? `Analyze this news video transcript for truthfulness, bias and misinformation:

TRANSCRIPT:
"${transcript}"

${context ? `Additional context: ${context}` : ""}

Carefully fact-check every claim made in this transcript.`
      : `Analyze this news video URL for truthfulness:
URL: ${url}
${context ? `User context: ${context}` : ""}
Give UNVERIFIED verdict if no content available.`;

   // Run full TruthVerse Algorithm on transcript
const [mlResult, newsResult, groqResult] = await Promise.all([
  transcript ? runMLModel(transcript) : Promise.resolve({ ml_score: 50, ml_verdict: "UNVERIFIED", confidence: 0 }),
  transcript ? crossVerifyNews(transcript) : Promise.resolve({ source_score: 50, sources_found: 0, top_sources: [] }),
  callGroq(analysisPrompt)
]);

const finalScore = calculateTruthScore(
  mlResult.ml_score || 50,
  newsResult.source_score || 50,
  groqResult.truthScore || 50
);

const result = {
  ...groqResult,
  truthScore: finalScore,
  mlAnalysis: {
    ml_score: mlResult.ml_score,
    ml_verdict: mlResult.ml_verdict,
    confidence: mlResult.confidence
  },
  newsVerification: {
    sources_found: newsResult.sources_found,
    source_score: newsResult.source_score,
    top_sources: newsResult.top_sources
  },
  algorithmUsed: "TruthVerse Credibility Algorithm: (ML×0.4) + (NewsAPI×0.4) + (Groq×0.2)"
};

if (transcript) result.transcript = transcript;

    // Cleanup
    try { fs.unlinkSync(audioPath); } catch {}

    res.json(result);
  } catch (err) {
    try { fs.unlinkSync(audioPath); } catch {}
    console.error("Video URL error:", err.message);
    res.status(500).json({ error: err.message });
  }
});


app.get("/api/health", (_, res) => res.json({
  status:    "ok",
  text:      "DistilBERT (53k samples) + NewsAPI + Groq",
  image:     "Hive AI Detection (V3) + Groq",
  video:     "ffmpeg + Groq Whisper + DistilBERT + Groq",
  videoUrl:  "Groq source credibility analysis",
  algorithm: "TruthVerse Credibility Algorithm"
}));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ TruthLens running on http://localhost:${PORT}`);
  console.log(`📝 Text    → Groq (llama-3.3-70b)`);
  console.log(`🖼  Image   → Hive AI Detection`);
  console.log(`🎬 Video   → ffmpeg + Groq Whisper → fact-check`);
  console.log(`🔗 URL     → Groq source analysis`);
  if (!GROQ_API_KEY) console.log(`⚠️  GROQ_API_KEY missing!`);
  if (!HIVE_API_KEY) console.log(`⚠️  HIVE_API_KEY missing!`);
});
