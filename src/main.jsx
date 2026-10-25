import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const HOP_SECONDS = 0.25;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: "◈", hint: "Command pulse" },
  { id: "queue", label: "Triage Queue", icon: "◉", hint: "04 active" },
  { id: "monitor", label: "Live Monitor", icon: "⌁", hint: "Audio stream" },
  { id: "intelligence", label: "Intelligence", icon: "▣", hint: "Signal fusion" },
  { id: "cases", label: "Case Files", icon: "◌", hint: "Evidence desk" },
];

const RISK_CONFIG = {
  CRITICAL: { accent: "#ff4d7d", label: "CRITICAL", className: "critical" },
  HIGH: { accent: "#ff9f43", label: "HIGH", className: "high" },
  MODERATE: { accent: "#ffcf67", label: "MODERATE", className: "moderate" },
  LOW: { accent: "#42e8c1", label: "LOW", className: "low" },
};

const PROFILE_LIBRARY = {
  "101": {
    risk: "CRITICAL",
    urgency: 96,
    tag: "GOLDEN HOUR",
    base: { distress: 91, fear: 88, anger: 26, nervousness: 73, calm: 8 },
    f0: 283,
    jitter: 6.8,
    rms: 0.42,
    speechRate: 5.6,
    semanticBonus: 30,
  },
  "102": {
    risk: "HIGH",
    urgency: 82,
    tag: "URGENT",
    base: { distress: 45, fear: 59, anger: 12, nervousness: 85, calm: 24 },
    f0: 173,
    jitter: 4.8,
    rms: 0.25,
    speechRate: 4.9,
    semanticBonus: 22,
  },
  "103": {
    risk: "HIGH",
    urgency: 79,
    tag: "URGENT",
    base: { distress: 63, fear: 24, anger: 92, nervousness: 39, calm: 13 },
    f0: 145,
    jitter: 2.7,
    rms: 0.57,
    speechRate: 5.2,
    semanticBonus: 17,
  },
  "104": {
    risk: "MODERATE",
    urgency: 54,
    tag: "REVIEW",
    base: { distress: 15, fear: 12, anger: 17, nervousness: 39, calm: 78 },
    f0: 142,
    jitter: 1.7,
    rms: 0.19,
    speechRate: 3.6,
    semanticBonus: 14,
  },
  local: {
    risk: "MODERATE",
    urgency: 58,
    tag: "LOCAL INPUT",
    base: { distress: 37, fear: 31, anger: 22, nervousness: 45, calm: 46 },
    f0: 171,
    jitter: 3.5,
    rms: 0.28,
    speechRate: 4.0,
    semanticBonus: 8,
  },
};

const FALLBACK_CALLS = [
  {
    id: "101",
    filename: "call_101_victim_upi_fraud.wav",
    audioUrl: "/sample_calls/call_101_victim_upi_fraud.wav",
    callerId: "+91-XXXXXX4821",
    callerType: "Distressed Victim",
    crimeType: "UPI Fraud — Unauthorized Debit",
    timestamp: "08:47:12",
    duration: 12,
    transcript:
      "Hello? Please help me! Someone... someone has taken money from my account! I received an OTP and before I could... they did a digital arrest... my UPI... ₹2,45,000 is gone! Please freeze my account! I'm begging you!",
    keywords: ["OTP shared", "digital arrest", "UPI unauthorized debit", "account freeze"],
  },
  {
    id: "102",
    filename: "call_102_informant_ransomware_tip.wav",
    audioUrl: "/sample_calls/call_102_informant_ransomware_tip.wav",
    callerId: "+91-XXXXXX7293",
    callerType: "Informant Tip",
    crimeType: "Ransomware Attack Intelligence",
    timestamp: "08:52:35",
    duration: 10,
    transcript:
      "Listen... I can't talk long... there's a group operating from... they're planning a ransomware attack on the municipal server... the malware is already planted... you need to check the backup systems... I'll send proof to the secure email...",
    keywords: ["ransomware", "malware", "municipal server", "secure email"],
  },
  {
    id: "103",
    filename: "call_103_angry_account_compromise.wav",
    audioUrl: "/sample_calls/call_103_angry_account_compromise.wav",
    callerId: "+91-XXXXXX1056",
    callerType: "Distressed Victim",
    crimeType: "Bank Account Compromise",
    timestamp: "09:01:48",
    duration: 11,
    transcript:
      "What the HELL is going on?! My entire savings account has been WIPED OUT! I've been calling your helpline for TWO HOURS! Someone cloned my SIM card and bypassed the authentication! I want the cyber cell HEAD on the phone NOW!",
    keywords: ["SIM clone", "authentication bypass", "savings wiped", "cyber cell"],
  },
  {
    id: "104",
    filename: "call_104_suspected_vishing_caller.wav",
    audioUrl: "/sample_calls/call_104_suspected_vishing_caller.wav",
    callerId: "+91-XXXXXX5580",
    callerType: "Suspected Fraudster / Vishing",
    crimeType: "Vishing / Social Engineering Attempt",
    timestamp: "09:15:22",
    duration: 10,
    transcript:
      "Good morning officer. I am calling from the Reserve Bank compliance department. We have detected suspicious activity on accounts in your jurisdiction. I need you to verify the nodal officer credentials and share the secure access token for the banking portal.",
    keywords: ["Reserve Bank impersonation", "credential request", "access token phishing"],
  },
].map(applyProfile);

function applyProfile(call) {
  const profile = PROFILE_LIBRARY[call.id] || call.profile || PROFILE_LIBRARY.local;
  return { ...call, ...profile };
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function pseudoNoise(seed) {
  return Math.sin(seed * 12.9898) * 0.5 + Math.sin(seed * 2.319) * 0.3 + Math.cos(seed * 5.411) * 0.2;
}

function makeTelemetry(call, duration) {
  const profile = PROFILE_LIBRARY[call.id] || call.profile || PROFILE_LIBRARY.local;
  const safeDuration = Math.max(4, Number(duration || call.duration || 10));
  const frames = Math.max(20, Math.ceil(safeDuration / HOP_SECONDS) + 1);

  return Array.from({ length: frames }, (_, index) => {
    const t = Math.min(safeDuration, index * HOP_SECONDS);
    const phase = t / safeDuration;
    const burst = Math.exp(-Math.pow((phase - 0.58) / 0.1, 2));
    const pulse = Math.exp(-Math.pow((phase - 0.24) / 0.08, 2));
    const noise = pseudoNoise(index + Number.parseInt(call.id, 10) || index);
    const base = profile.base;
    const distress = clamp(base.distress + Math.sin(t * 2.2) * 7 + burst * 10 + noise * 5);
    const fear = clamp(base.fear + Math.cos(t * 2.9) * 6 + pulse * 10 + noise * 4);
    const anger = clamp(base.anger + Math.sin(t * 3.4 + 1.2) * 7 + burst * (call.id === "103" ? 14 : 4));
    const nervousness = clamp(base.nervousness + Math.sin(t * 4.1 + 0.8) * 7 + pulse * 8 + noise * 4);
    const calm = clamp(base.calm - burst * 13 - pulse * 5 + Math.cos(t * 1.45) * 4);
    const urgency = clamp(
      profile.urgency + (distress - base.distress) * 0.1 + (fear - base.fear) * 0.07 + (anger - base.anger) * 0.06,
      0,
      100,
    );

    return {
      t,
      emotions: { distress, fear, anger, nervousness, calm },
      urgency,
      features: {
        f0: Math.max(70, profile.f0 + Math.sin(t * 2.4) * 14 + burst * 24 + noise * 8),
        jitter: clamp(profile.jitter + Math.abs(Math.sin(t * 3.1)) * 0.9 + burst * 0.7, 0, 12),
        rms: clamp(profile.rms + Math.sin(t * 5.2) * 0.06 + burst * 0.09, 0.03, 0.95),
        speechRate: clamp(profile.speechRate + Math.sin(t * 1.8) * 0.45 + pulse * 0.35, 1, 8),
        centroid: clamp(1360 + profile.rms * 2850 + anger * 9 + Math.cos(t * 3.2) * 110, 700, 5200),
      },
    };
  });
}

function normaliseMetadata(metadata) {
  return Object.entries(metadata)
    .map(([filename, item]) => {
      const id = filename.match(/call_(\d+)/)?.[1] || `local-${filename}`;
      const timestamp = String(item.timestamp || "").split("T")[1]?.slice(0, 8) || "LIVE";
      return applyProfile({
        id,
        filename,
        audioUrl: `/sample_calls/${encodeURIComponent(filename)}`,
        callerId: item.caller_id || "Private caller",
        callerType: item.caller_type || "Unknown caller",
        crimeType: item.crime_type || "Unclassified incident",
        timestamp,
        duration: Number(item.duration_sec) || 10,
        transcript: item.transcript || "No transcript is available for this evidence item.",
        keywords: item.keywords_detected || [],
      });
    })
    .sort((left, right) => right.urgency - left.urgency);
}

function splitTranscript(transcript, duration) {
  const fragments = transcript.match(/[^.!?]+(?:\.\.\.|[.!?]+|$)/g) || [transcript];
  const totalWeight = fragments.reduce((sum, fragment) => sum + Math.max(12, fragment.trim().length), 0);
  let cursor = 0;
  return fragments
    .map((fragment, index) => {
      const weight = Math.max(12, fragment.trim().length);
      const length = (duration * weight) / totalWeight;
      const segment = {
        id: `${index}-${fragment.slice(0, 8)}`,
        text: fragment.trim(),
        start: cursor,
        end: Math.min(duration, cursor + length),
      };
      cursor += length;
      return segment;
    })
    .filter((segment) => segment.text);
}

function redactPII(value) {
  return String(value)
    .replace(/\+?91[-\s]?\d{3}[-\s]?\d{3}[-\s]?\d{4}/g, (match) => `+91-XXXXXX${match.replace(/\D/g, "").slice(-4)}`)
    .replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, (match) => `XXXX XXXX ${match.replace(/\D/g, "").slice(-4)}`)
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, (match) => `XXXXX${match.slice(5, 9)}X`)
    .replace(/\b\d{9,18}\b/g, (match) => `XXXXXXXX${match.slice(-4)}`)
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[REDACTED EMAIL]")
    .replace(/₹\s?\d{1,3}(?:,\d{2})*(?:,\d{3})?/g, "₹X,XX,XXX");
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "00:00";
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function getRisk(score) {
  if (score >= 80) return RISK_CONFIG.CRITICAL;
  if (score >= 60) return RISK_CONFIG.HIGH;
  if (score >= 40) return RISK_CONFIG.MODERATE;
  return RISK_CONFIG.LOW;
}

function useKolkataClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const time = useMemo(
    () =>
      new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(now),
    [now],
  );

  const date = useMemo(
    () =>
      new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        weekday: "short",
        day: "2-digit",
        month: "short",
      })
        .format(now)
        .toUpperCase(),
    [now],
  );

  return { time, date };
}

function makeSyntheticWavBlob(duration = 10, seed = 1) {
  const sampleRate = 16000;
  const total = Math.max(1, Math.floor(duration * sampleRate));
  const buffer = new ArrayBuffer(44 + total * 2);
  const view = new DataView(buffer);
  const writeText = (offset, text) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + total * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, total * 2, true);

  // Deterministic pseudo-random noise so every synthetic asset is reproducible.
  let noiseState = (seed * 2654435761) >>> 0;
  const noise = () => {
    noiseState = (noiseState * 1664525 + 1013904223) >>> 0;
    return (noiseState / 4294967296) * 2 - 1;
  };
  const basePitch = 150 + (seed % 5) * 26;
  for (let index = 0; index < total; index += 1) {
    const t = index / sampleRate;
    const phrase = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.9 * t + seed);
    const env = Math.max(0, Math.min(1, phrase)) * (0.35 + 0.65 * Math.abs(Math.sin(2 * Math.PI * 2.4 * t)));
    const vibrato = 1 + 0.035 * Math.sin(2 * Math.PI * 5.2 * t);
    const carrier = Math.sin(2 * Math.PI * basePitch * vibrato * t) * 0.5
      + Math.sin(2 * Math.PI * basePitch * 2 * t) * 0.22
      + Math.sin(2 * Math.PI * basePitch * 3 * t) * 0.1;
    const sample = Math.max(-1, Math.min(1, (carrier * env + noise() * 0.02) * 0.55));
    view.setInt16(44 + index * 2, Math.round(sample * 32767), true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function useEvidenceHash(audioUrl) {
  const [hash, setHash] = useState("Computing integrity hash…");

  useEffect(() => {
    let disposed = false;
    if (!audioUrl || !window.crypto?.subtle) {
      setHash("Hash unavailable in this browser");
      return undefined;
    }

    setHash("Computing integrity hash…");
    fetch(audioUrl)
      .then((response) => {
        if (!response.ok) throw new Error("Unable to read audio evidence");
        return response.arrayBuffer();
      })
      .then((buffer) => window.crypto.subtle.digest("SHA-256", buffer))
      .then((digest) => {
        if (disposed) return;
        const result = Array.from(new Uint8Array(digest))
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        setHash(result);
      })
      .catch(() => {
        if (!disposed) setHash("Hash unavailable for this local source");
      });

    return () => {
      disposed = true;
    };
  }, [audioUrl]);

  return hash;
}

function Panel({ title, eyebrow, action, className = "", children }) {
  return (
    <section className={`panel ${className}`}>
      {(title || eyebrow || action) && (
        <header className="panel-header">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h2>{title}</h2>}
          </div>
          {action && <div className="panel-action">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

function Icon({ children, label }) {
  return (
    <span className="icon" aria-hidden={label ? undefined : "true"} title={label}>
      {children}
    </span>
  );
}

function RiskBadge({ score, tag }) {
  const risk = getRisk(score);
  return (
    <span className={`risk-badge ${risk.className}`}>
      <i />
      {tag || risk.label}
    </span>
  );
}

function Sidebar({ activeView, onNavigate, queueSize, isRecording }) {
  return (
    <aside className="sidebar" aria-label="Command center navigation">
      <div className="brand-lockup">
        <div className="brand-mark"><span>⌁</span></div>
        <div>
          <strong>ARGUS</strong>
          <small>CYBER AUDIO OPS</small>
        </div>
      </div>

      <div className="sidebar-section-label">COMMAND CENTER</div>
      <nav className="nav-stack">
        {NAV_ITEMS.map((item) => (
          <button
            type="button"
            key={item.id}
            className={`nav-item ${activeView === item.id ? "active" : ""}`}
            onClick={() => onNavigate(item.id)}
            aria-current={activeView === item.id ? "page" : undefined}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-copy"><b>{item.label}</b><small>{item.hint}</small></span>
            {item.id === "queue" && <span className="nav-count">{String(queueSize).padStart(2, "0")}</span>}
            {item.id === "monitor" && isRecording && <span className="nav-recording" title="Live microphone capture" />}
          </button>
        ))}
      </nav>

      <div className="sidebar-spacer" />
      <div className="system-card">
        <div className="system-card-top"><span className="status-orb" /> SYSTEM HEALTH</div>
        <strong>All systems nominal</strong>
        <small>Local-first evidence flow</small>
      </div>
      <div className="analyst-card">
        <span>ACTIVE ANALYST</span>
        <strong>Officer 07</strong>
        <i>Secure session</i>
      </div>
    </aside>
  );
}

function KpiRibbon({ calls, selectedCall, currentFrame, isRecording }) {
  const criticalCount = calls.filter((call) => call.urgency >= 80).length;
  const dominant = Object.entries(currentFrame.emotions || {})
    .sort((left, right) => right[1] - left[1])[0]?.[0] || "calm";
  const score = Math.round(currentFrame.urgency || selectedCall.urgency || 0);
  const stress = Math.round(
    ((currentFrame.emotions?.distress || 0) + (currentFrame.emotions?.fear || 0) + (currentFrame.emotions?.nervousness || 0)) / 3,
  );

  return (
    <section className="kpi-ribbon" aria-label="Operational metrics">
      <div className="kpi-card">
        <span>ACTIVE QUEUE</span>
        <strong>{String(calls.length).padStart(2, "0")}</strong>
        <small><b className="teal-dot" /> Priority-sorted calls</small>
      </div>
      <div className="kpi-card alert">
        <span>CRITICAL FLAGS</span>
        <strong>{String(criticalCount).padStart(2, "0")}</strong>
        <small><b className="red-dot" /> Golden-hour protection</small>
      </div>
      <div className="kpi-card">
        <span>LIVE URGENCY</span>
        <strong>{score}<em>/100</em></strong>
        <small>{isRecording ? "Mic stream active" : "Window-synchronized"}</small>
      </div>
      <div className="kpi-card">
        <span>DOMINANT SIGNAL</span>
        <strong className="kpi-word">{dominant}</strong>
        <small>Acoustic indicator</small>
      </div>
      <div className="kpi-card">
        <span>STRESS INDEX</span>
        <strong>{stress}<em>%</em></strong>
        <small>Current 250 ms frame</small>
      </div>
    </section>
  );
}

function QueueList({ calls, selectedId, onSelect, onOpenMonitor }) {
  return (
    <div className="queue-list">
      {calls
        .slice()
        .sort((left, right) => right.urgency - left.urgency)
        .map((call) => {
          const risk = getRisk(call.urgency);
          return (
            <button
              type="button"
              className={`queue-row ${selectedId === call.id ? "selected" : ""}`}
              key={call.id}
              onClick={() => onSelect(call.id)}
            >
              <span className={`queue-severity ${risk.className}`} />
              <span className="queue-main">
                <span className="queue-call-top"><strong>{call.crimeType}</strong><RiskBadge score={call.urgency} tag={call.tag} /></span>
                <small>{call.callerType} · {call.callerId} · {call.timestamp}</small>
              </span>
              <span className="queue-score"><b>{Math.round(call.urgency)}</b><small>URGENCY</small></span>
              <span className="queue-open" onClick={(event) => { event.stopPropagation(); onOpenMonitor(call.id); }} role="button" tabIndex={0} aria-label={`Open ${call.crimeType} in live monitor`}>↗</span>
            </button>
          );
        })}
    </div>
  );
}

function SignalScope({ analyserRef, currentTime, duration, isPlaying, isRecording, accent }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d");
    let frameId;
    let sampleData;

    const resize = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(320, Math.floor(bounds.width * ratio));
      const height = Math.max(160, Math.floor(bounds.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      return { width, height, ratio };
    };

    const draw = () => {
      const { width, height, ratio } = resize();
      context.clearRect(0, 0, width, height);
      const w = width / ratio;
      const h = height / ratio;
      context.save();
      context.scale(ratio, ratio);

      const background = context.createLinearGradient(0, 0, w, h);
      background.addColorStop(0, "rgba(5, 20, 34, 0.98)");
      background.addColorStop(1, "rgba(9, 39, 54, 0.65)");
      context.fillStyle = background;
      context.fillRect(0, 0, w, h);

      context.strokeStyle = "rgba(100, 152, 171, 0.16)";
      context.lineWidth = 1;
      for (let x = 0; x <= w; x += w / 10) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, h);
        context.stroke();
      }
      for (let y = 0; y <= h; y += h / 5) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(w, y);
        context.stroke();
      }

      const analyser = analyserRef.current;
      const points = 180;
      if (analyser) {
        if (!sampleData || sampleData.length !== analyser.fftSize) sampleData = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(sampleData);
      }

      context.beginPath();
      for (let index = 0; index < points; index += 1) {
        let normalized;
        if (analyser && sampleData) {
          const sourceIndex = Math.floor((index / (points - 1)) * (sampleData.length - 1));
          normalized = (sampleData[sourceIndex] - 128) / 128;
        } else {
          const t = currentTime * 3.4 + index * 0.25;
          normalized = (Math.sin(t) * 0.42 + Math.sin(t * 2.17) * 0.19 + Math.sin(t * 0.33) * 0.17) * (0.55 + 0.45 * Math.sin(index * 0.4) ** 2);
          if (!isPlaying && !isRecording) normalized *= 0.18;
        }
        const x = (index / (points - 1)) * w;
        const y = h / 2 + normalized * h * 0.34;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }

      const waveformGradient = context.createLinearGradient(0, 0, w, 0);
      waveformGradient.addColorStop(0, "#55efd0");
      waveformGradient.addColorStop(0.5, accent || "#55efd0");
      waveformGradient.addColorStop(1, "#b090ff");
      context.strokeStyle = waveformGradient;
      context.lineWidth = 2.25;
      context.shadowBlur = 18;
      context.shadowColor = accent || "#55efd0";
      context.stroke();
      context.shadowBlur = 0;

      context.strokeStyle = "rgba(255,255,255,0.16)";
      context.setLineDash([3, 5]);
      context.beginPath();
      context.moveTo(0, h / 2);
      context.lineTo(w, h / 2);
      context.stroke();
      context.setLineDash([]);

      const progress = duration > 0 ? clamp(currentTime / duration, 0, 1) : 0;
      const playheadX = progress * w;
      context.fillStyle = "rgba(76, 230, 193, 0.12)";
      context.fillRect(0, 0, playheadX, h);
      context.strokeStyle = "#fff6cf";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(playheadX, 0);
      context.lineTo(playheadX, h);
      context.stroke();
      context.fillStyle = "#fff6cf";
      context.beginPath();
      context.arc(playheadX, 15, 4, 0, Math.PI * 2);
      context.fill();

      context.restore();
      if (isPlaying || isRecording) frameId = window.requestAnimationFrame(draw);
    };

    draw();
    return () => window.cancelAnimationFrame(frameId);
  }, [analyserRef, currentTime, duration, isPlaying, isRecording, accent]);

  return <canvas ref={canvasRef} className="signal-scope" aria-label="Live audio waveform signal" />;
}

function EmotionTimeline({ timeline, currentTime, duration }) {
  const width = 830;
  const height = 250;
  const pad = { left: 40, right: 16, top: 18, bottom: 30 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const colorMap = {
    distress: "#ff537d",
    fear: "#ff9e55",
    anger: "#c582ff",
    nervousness: "#ffd166",
    calm: "#48e6c1",
  };
  const emotions = Object.keys(colorMap);
  const points = (emotion) => timeline
    .map((frame) => {
      const x = pad.left + (frame.t / Math.max(duration, 1)) * plotWidth;
      const y = pad.top + (1 - frame.emotions[emotion] / 100) * plotHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const progressX = pad.left + clamp(currentTime / Math.max(duration, 1), 0, 1) * plotWidth;
  const active = timeline[Math.min(timeline.length - 1, Math.floor(currentTime / HOP_SECONDS))] || timeline[0];

  return (
    <div className="timeline-chart" role="img" aria-label="Emotion timeline synchronized to audio playback">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="timelineShade" x1="0" x2="1">
            <stop offset="0" stopColor="#45e7c2" stopOpacity="0.1" />
            <stop offset="1" stopColor="#ff537d" stopOpacity="0.03" />
          </linearGradient>
        </defs>
        <rect x={pad.left} y={pad.top} width={plotWidth} height={plotHeight} fill="url(#timelineShade)" rx="8" />
        {[0, 25, 50, 75, 100].map((value) => {
          const y = pad.top + (1 - value / 100) * plotHeight;
          return <g key={value}><line x1={pad.left} x2={width - pad.right} y1={y} y2={y} className="timeline-grid" /><text x="4" y={y + 3} className="timeline-axis">{value}</text></g>;
        })}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const x = pad.left + ratio * plotWidth;
          return <g key={ratio}><line x1={x} x2={x} y1={pad.top} y2={height - pad.bottom} className="timeline-grid vertical" /><text x={x} y={height - 8} textAnchor="middle" className="timeline-axis">{formatTime(duration * ratio)}</text></g>;
        })}
        {emotions.map((emotion) => <polyline key={emotion} points={points(emotion)} fill="none" stroke={colorMap[emotion]} strokeWidth="2.25" className="emotion-line" />)}
        <line x1={progressX} x2={progressX} y1={pad.top} y2={height - pad.bottom} className="timeline-playhead" />
        {active && emotions.map((emotion) => {
          const y = pad.top + (1 - active.emotions[emotion] / 100) * plotHeight;
          return <circle key={emotion} cx={progressX} cy={y} r="3.8" fill={colorMap[emotion]} className="timeline-point" />;
        })}
      </svg>
      <div className="timeline-legend">
        {emotions.map((emotion) => <span key={emotion}><i style={{ background: colorMap[emotion] }} />{emotion}</span>)}
      </div>
    </div>
  );
}

function EmotionRadar({ emotions, active = false }) {
  const labels = ["Distress", "Fear", "Anger", "Nervousness", "Calm"];
  const keys = ["distress", "fear", "anger", "nervousness", "calm"];
  const center = 110;
  const radius = 78;
  const coordinates = (index, scale = 1) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / labels.length;
    return [center + Math.cos(angle) * radius * scale, center + Math.sin(angle) * radius * scale];
  };
  const shape = keys.map((key, index) => coordinates(index, (emotions[key] || 0) / 100).join(",")).join(" ");

  return (
    <div className="radar-wrap">
      <svg viewBox="0 0 220 220" className={`radar-chart ${active ? "radar-active" : "radar-standby"}`} role="img" aria-label="Live voice emotion profile radar">
        {[0.25, 0.5, 0.75, 1].map((scale) => <polygon key={scale} points={labels.map((_, index) => coordinates(index, scale).join(",")).join(" ")} className="radar-grid" />)}
        {labels.map((label, index) => {
          const [x, y] = coordinates(index, 1);
          const [labelX, labelY] = coordinates(index, 1.23);
          return <g key={label}><line x1={center} y1={center} x2={x} y2={y} className="radar-axis" /><text x={labelX} y={labelY} textAnchor="middle" className="radar-label">{label}</text></g>;
        })}
        <g className="radar-vector-plane">
          <polygon points={shape} className="radar-fill" />
          {keys.map((key, index) => {
            const [x, y] = coordinates(index, (emotions[key] || 0) / 100);
            return <circle key={key} cx={x} cy={y} r="3.3" className="radar-node" />;
          })}
        </g>
        <circle cx={center} cy={center} r="4" className="radar-center" />
      </svg>
      <div className="radar-status-banner">
        <span>{active ? "● VECTOR TRACKING LIVE" : "○ STANDBY · PRESS PLAY"}</span>
        <span>5-AXIS ACOUSTIC</span>
      </div>
    </div>
  );
}

function UrgencyGauge({ value }) {
  const normalized = clamp(value, 0, 100);
  const radius = 56;
  const circumference = Math.PI * radius;
  const offset = circumference * (1 - normalized / 100);
  const risk = getRisk(normalized);
  return (
    <div className="urgency-gauge">
      <svg viewBox="0 0 150 93" role="img" aria-label={`Current urgency score ${Math.round(normalized)} out of 100`}>
        <path d="M 19 75 A 56 56 0 0 1 131 75" fill="none" className="gauge-track" pathLength="100" />
        <path d="M 19 75 A 56 56 0 0 1 131 75" fill="none" className={`gauge-value ${risk.className}`} pathLength="100" strokeDasharray="100" strokeDashoffset={100 - normalized} />
        <text x="75" y="63" textAnchor="middle" className="gauge-number">{Math.round(normalized)}</text>
        <text x="75" y="79" textAnchor="middle" className="gauge-label">URGENCY INDEX</text>
      </svg>
      <span className={`gauge-caption ${risk.className}`}>{risk.label}</span>
    </div>
  );
}

function MfccHeatmap({ currentTime, duration }) {
  const bands = 13;
  const columns = 33;
  const activeColumn = Math.floor((currentTime / Math.max(duration, 1)) * columns);
  const cells = [];
  for (let y = 0; y < bands; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const intensity = clamp(42 + Math.sin(x * 0.59 + y * 1.2) * 30 + Math.cos(x * 0.23 - y) * 22, 2, 98);
      cells.push(<span key={`${x}-${y}`} className={`mfcc-cell ${x === activeColumn ? "active" : ""}`} style={{ "--mfcc-intensity": `${intensity}%` }} />);
    }
  }
  return <div className="mfcc-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }} aria-label="MFCC spectral heatmap">{cells}</div>;
}

function AudioTransport({ isPlaying, currentTime, duration, onToggle, onSeek, onRestart, disabled }) {
  const progress = duration > 0 ? clamp((currentTime / duration) * 100, 0, 100) : 0;
  return (
    <div className="audio-transport">
      <div className="transport-main">
        <button type="button" className="transport-restart" onClick={onRestart} disabled={disabled} aria-label="Restart audio">↺</button>
        <button type="button" className="transport-play" onClick={onToggle} disabled={disabled} aria-label={isPlaying ? "Pause audio" : "Play audio"}>{isPlaying ? "Ⅱ" : "▶"}</button>
        <div className="transport-time"><strong>{formatTime(currentTime)}</strong><span>/ {formatTime(duration)}</span></div>
        <input
          className="transport-range"
          type="range"
          min="0"
          max={Math.max(duration, 0.01)}
          step="0.01"
          value={Math.min(currentTime, duration || currentTime)}
          onChange={(event) => onSeek(Number(event.target.value))}
          style={{ "--range-progress": `${progress}%` }}
          aria-label="Audio playback position"
          disabled={disabled || !duration}
        />
        <span className="transport-live"><i /> SIGNAL SYNC</span>
      </div>
    </div>
  );
}

function renderHighlighted(text, keywords) {
  const validKeywords = keywords.filter(Boolean);
  if (!validKeywords.length) return text;
  const expression = new RegExp(`(${validKeywords.map((keyword) => keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(expression).map((piece, index) => (
    validKeywords.some((keyword) => keyword.toLowerCase() === piece.toLowerCase())
      ? <mark key={`${piece}-${index}`}>{piece}</mark>
      : <React.Fragment key={`${piece}-${index}`}>{piece}</React.Fragment>
  ));
}

function TranscriptPanel({ segments, activeIndex, piiMode, keywords, autoFollow, onTogglePii, isRecording, captureTranscript }) {
  const segmentRefs = useRef([]);
  useEffect(() => {
    if (!autoFollow || activeIndex < 0) return;
    segmentRefs.current[activeIndex]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex, autoFollow]);

  const visibleSegments = isRecording && captureTranscript
    ? [{ id: "capture", text: captureTranscript, start: 0, end: Number.MAX_SAFE_INTEGER }]
    : segments;

  return (
    <Panel
      eyebrow="SEMANTIC + ACOUSTIC FUSION"
      title="Live transcript"
      action={
        <button type="button" className={`toggle ${piiMode ? "on" : ""}`} onClick={onTogglePii} aria-pressed={piiMode}>
          <span /> PII {piiMode ? "masked" : "visible"}
        </button>
      }
      className="transcript-panel"
    >
      <div className="transcript-state">
        <span className={isRecording ? "recording-dot" : "playback-dot"} />
        {isRecording ? "Capturing microphone transcript" : "Transcript follows audio playhead"}
        {isRecording && <span className="streaming-pill"><i className="live-pulse" /> LIVE STREAM</span>}
      </div>
      <div className="transcript-scroll">
        {visibleSegments.map((segment, index) => {
          const isActive = isRecording || index === activeIndex;
          const content = piiMode ? redactPII(segment.text) : segment.text;
          return (
            <p
              className={`transcript-segment ${isActive ? "active" : ""}`}
              key={segment.id}
              ref={(node) => { segmentRefs.current[index] = node; }}
            >
              {!isRecording && <time>{formatTime(segment.start)}</time>}
              <span>{renderHighlighted(content, keywords)}{isRecording && <i className="transcript-typing-cursor" aria-hidden="true" />}</span>
            </p>
          );
        })}
      </div>
      <div className="keyword-strip">
        {keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}
      </div>
    </Panel>
  );
}

function MetricsStrip({ frame }) {
  const metrics = [
    { label: "F0 mean", value: `${Math.round(frame.features.f0)} Hz`, tone: "teal" },
    { label: "Jitter", value: `${frame.features.jitter.toFixed(1)}%`, tone: "amber" },
    { label: "RMS energy", value: frame.features.rms.toFixed(2), tone: "purple" },
    { label: "Speech rate", value: `${frame.features.speechRate.toFixed(1)} /s`, tone: "cyan" },
    { label: "Centroid", value: `${Math.round(frame.features.centroid)} Hz`, tone: "pink" },
  ];
  return (
    <div className="metrics-strip">
      {metrics.map((metric) => <div key={metric.label} className={`metric-chip ${metric.tone}`}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}
    </div>
  );
}

function MonitorPanel({
  call,
  currentTime,
  duration,
  isPlaying,
  isRecording,
  currentFrame,
  timeline,
  analyserRef,
  onTogglePlayback,
  onSeek,
  onRestart,
  audioUnavailable,
}) {
  const accent = getRisk(currentFrame.urgency).accent;
  return (
    <div className="monitor-grid">
      <Panel
        eyebrow={isRecording ? "MICROPHONE INPUT / LIVE" : "EVIDENCE AUDIO / LIVE PLAYBACK"}
        title={call.crimeType}
        action={<RiskBadge score={currentFrame.urgency} tag={isRecording ? "LIVE CAPTURE" : call.tag} />}
        className="monitor-card signal-panel"
      >
        <div className="signal-meta">
          <div><span>CASE</span><strong>#{call.id}</strong></div>
          <div><span>CALLER PROFILE</span><strong>{call.callerType}</strong></div>
          <div><span>WINDOW</span><strong>{formatTime(currentTime)} · 250ms</strong></div>
        </div>
        <SignalScope analyserRef={analyserRef} currentTime={currentTime} duration={duration} isPlaying={isPlaying} isRecording={isRecording} accent={accent} />
        <AudioTransport
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          onToggle={onTogglePlayback}
          onSeek={onSeek}
          onRestart={onRestart}
          disabled={isRecording || audioUnavailable}
        />
        {audioUnavailable && <p className="audio-error">Audio source is unavailable. Select another evidence item or upload a valid audio file.</p>}
      </Panel>

      <Panel eyebrow="PRIORITY ENGINE" title="Urgency posture" className="monitor-card gauge-panel">
        <UrgencyGauge value={currentFrame.urgency} />
        <div className="gauge-notes">
          <p><span>Semantic triggers</span><strong>+{call.semanticBonus} pts</strong></p>
          <p><span>Acoustic stress</span><strong>{Math.round((currentFrame.emotions.distress + currentFrame.emotions.fear) / 2)}%</strong></p>
          <p><span>Human review</span><strong>Required</strong></p>
        </div>
      </Panel>

      <Panel eyebrow="EMOTION VECTOR" title="Live voice profile" className="monitor-card radar-panel">
        <EmotionRadar emotions={currentFrame.emotions} active={isPlaying || isRecording} />
        <div className="dominant-emotion-row">
          {Object.entries(currentFrame.emotions).sort((left, right) => right[1] - left[1]).slice(0, 2).map(([emotion, value]) => <span key={emotion}><b>{emotion}</b> {Math.round(value)}%</span>)}
        </div>
      </Panel>
    </div>
  );
}

function OverviewView(props) {
  const { calls, selectedId, onSelect, onOpenMonitor, ...monitorProps } = props;
  return (
    <>
      <section className="responsible-banner">
        <div className="directive-icon">⚖</div>
        <div><strong>RESPONSIBLE AI DIRECTIVE</strong><p>Voice indicators prioritize support and triage only. They do not establish honesty, intent, deception, or legal guilt. A trained officer must verify every operational decision.</p></div>
        <span>HUMAN-IN-THE-LOOP</span>
      </section>
      <div className="overview-layout">
        <Panel
          eyebrow="LIVE PRIORITY INTAKE"
          title="Active triage queue"
          action={<button type="button" className="text-button" onClick={() => onOpenMonitor(selectedId)}>Open monitor <span>↗</span></button>}
          className="queue-panel"
        >
          <QueueList calls={calls} selectedId={selectedId} onSelect={onSelect} onOpenMonitor={onOpenMonitor} />
        </Panel>
        <div className="overview-side">
          <Panel eyebrow="CURRENT DECISION WINDOW" title="Tactical recommendations" className="recommendation-panel">
            <RecommendationList call={monitorProps.call} frame={monitorProps.currentFrame} />
          </Panel>
          <Panel eyebrow="LIVE EVENT BUS" title="Operational activity" className="event-panel">
            <EventFeed events={monitorProps.events} />
          </Panel>
        </div>
      </div>
      <MonitorPanel {...monitorProps} />
      <div className="telemetry-layout">
        <Panel eyebrow="WINDOWED DSP TELEMETRY" title="Emotion trajectory" className="timeline-panel">
          <EmotionTimeline timeline={monitorProps.timeline} currentTime={monitorProps.currentTime} duration={monitorProps.duration} />
        </Panel>
        <Panel eyebrow="MEL-FREQUENCY ANALYSIS" title="MFCC spectral profile" className="mfcc-panel">
          <MfccHeatmap currentTime={monitorProps.currentTime} duration={monitorProps.duration} />
          <p className="mfcc-note"><span /> Highlighted band tracks the active audio window in real time.</p>
        </Panel>
      </div>
      <MetricsStrip frame={monitorProps.currentFrame} />
    </>
  );
}

function RecommendationList({ call, frame }) {
  const highest = Object.entries(frame.emotions).sort((left, right) => right[1] - left[1])[0]?.[0] || "calm";
  const score = Math.round(frame.urgency);
  return (
    <div className="recommendation-list">
      <div className="recommendation active"><span>01</span><div><strong>{score >= 80 ? "Activate golden-hour response" : "Maintain priority review"}</strong><small>Urgency {score}/100 · officer confirmation needed</small></div></div>
      <div className="recommendation"><span>02</span><div><strong>Verify the reported transaction path</strong><small>{call.keywords.slice(0, 2).join(" · ")}</small></div></div>
      <div className="recommendation"><span>03</span><div><strong>Record neutral observation notes</strong><small>Dominant acoustic signal: {highest}</small></div></div>
    </div>
  );
}

function EventFeed({ events }) {
  return (
    <div className="event-feed">
      {events.slice(0, 5).map((event) => <div className="event-row" key={event.id}><span className={`event-dot ${event.tone || "teal"}`} /><time>{event.time}</time><p>{event.message}</p></div>)}
    </div>
  );
}

function QueueView({ calls, selectedId, onSelect, onOpenMonitor, onAction }) {
  return (
    <div className="view-stack">
      <Panel eyebrow="SORTED BY COMPOSITE URGENCY" title="Multi-call tactical queue" action={<span className="queue-filter">● LIVE · {calls.length} channels</span>}>
        <div className="queue-table-head"><span>PRIORITY / CASE</span><span>CALLER PROFILE</span><span>TRIGGER CONTEXT</span><span>URGENCY</span><span>OPEN</span></div>
        <div className="full-queue-table">
          {calls.slice().sort((a, b) => b.urgency - a.urgency).map((call) => (
            <button type="button" className={`full-queue-row ${selectedId === call.id ? "selected" : ""}`} key={call.id} onClick={() => onSelect(call.id)}>
              <span className="full-case"><RiskBadge score={call.urgency} tag={call.tag} /><strong>#{call.id}</strong><small>{call.crimeType}</small></span>
              <span><strong>{call.callerType}</strong><small>{call.callerId}</small></span>
              <span className="queue-keywords">{call.keywords.slice(0, 2).map((keyword) => <i key={keyword}>{keyword}</i>)}</span>
              <span className="full-score"><b>{Math.round(call.urgency)}</b><span><i style={{ width: `${call.urgency}%` }} /></span></span>
              <span className="row-open" onClick={(event) => { event.stopPropagation(); onOpenMonitor(call.id); }} role="button" tabIndex={0}>Open ↗</span>
            </button>
          ))}
        </div>
      </Panel>
      <div className="queue-actions-grid">
        <button type="button" onClick={() => onAction("Queue refresh requested", "The local triage order was recalculated. No data was sent externally.")}><Icon>↻</Icon><span><b>Refresh local order</b><small>Re-score local triage queue</small></span></button>
        <button type="button" onClick={() => onAction("Supervisor briefing prepared", "A briefing draft is ready for human review.")}><Icon>▤</Icon><span><b>Prepare briefing</b><small>Generate a review-ready summary</small></span></button>
        <button type="button" onClick={() => onAction("Queue watch enabled", "Visual alert monitoring is active in this browser tab.")}><Icon>◉</Icon><span><b>Watch queue</b><small>Surface new critical changes</small></span></button>
      </div>
    </div>
  );
}

function IntelligenceView({ call, currentFrame, timeline, currentTime, duration, piiMode, onTogglePii }) {
  const ranked = Object.entries(currentFrame.emotions).sort((a, b) => b[1] - a[1]);
  return (
    <div className="view-stack intelligence-view">
      <div className="intelligence-layout">
        <Panel eyebrow="EXPLAINABLE SIGNAL FUSION" title="Why this call is prioritized" className="xai-panel">
          <div className="xai-hero"><span>AI</span><div><strong>{ranked[0]?.[0]} is the leading acoustic indicator</strong><p>Current window shows F0 at {Math.round(currentFrame.features.f0)} Hz, jitter at {currentFrame.features.jitter.toFixed(1)}%, and an urgency index of {Math.round(currentFrame.urgency)}.</p></div></div>
          <div className="xai-reasons">
            <p><i>01</i><span><strong>Voice instability</strong>Pitch variance and jitter are interpreted as assistive stress signals, never as proof of intent.</span></p>
            <p><i>02</i><span><strong>Semantic escalation</strong>{call.keywords.slice(0, 3).join(", ")} elevate triage attention for officer verification.</span></p>
            <p><i>03</i><span><strong>Time-sensitive safeguard</strong>The score informs recommended support actions; it does not automate external interventions.</span></p>
          </div>
        </Panel>
        <Panel eyebrow="LIVE FEATURE VECTOR" title="Current acoustic telemetry" className="feature-panel">
          <MetricsStrip frame={currentFrame} />
          <div className="feature-bars">
            {ranked.map(([emotion, value]) => <div key={emotion}><span>{emotion}</span><b><i style={{ width: `${value}%` }} /></b><strong>{Math.round(value)}%</strong></div>)}
          </div>
        </Panel>
      </div>
      <Panel eyebrow="WINDOWED EMOTION ESTIMATES" title="Signal motion across the active call">
        <EmotionTimeline timeline={timeline} currentTime={currentTime} duration={duration} />
      </Panel>
      <TranscriptPanel segments={splitTranscript(call.transcript, call.duration || duration)} activeIndex={Math.floor(currentTime / Math.max(duration, 1) * splitTranscript(call.transcript, call.duration || duration).length)} piiMode={piiMode} keywords={call.keywords} autoFollow={false} onTogglePii={onTogglePii} isRecording={false} captureTranscript="" />
    </div>
  );
}

function CaseFilesView({ calls, selectedCall, evidenceHash, onDownload, onCopyHash, onSelect, onAction }) {
  return (
    <div className="view-stack case-files-view">
      <div className="case-summary-grid">
        <Panel eyebrow="CHAIN OF CUSTODY" title="Selected evidence asset" className="integrity-panel">
          <div className="integrity-shield">✓</div>
          <div className="integrity-copy"><strong>Integrity fingerprint ready</strong><small>SHA-256 derived locally from the current audio asset.</small><code>{evidenceHash}</code></div>
          <div className="integrity-actions"><button type="button" onClick={onCopyHash}>Copy hash</button><button type="button" onClick={onDownload}>Export case brief</button></div>
        </Panel>
        <Panel eyebrow="EPHEMERAL PROCESSING" title="Privacy status" className="privacy-panel">
          <div className="privacy-status"><span>IN-MEMORY</span><strong>Display redaction active</strong><p>Browser UI masks transcript PII when enabled. Verify your operational storage policy before handling real evidence.</p></div>
          <button type="button" onClick={() => onAction("Privacy review opened", "Confirm local policy before exporting or sharing case materials.")}>Review handling directive ↗</button>
        </Panel>
      </div>
      <Panel eyebrow="LOCAL CASE INDEX" title="Evidence available in this session">
        <div className="case-file-list">
          {calls.map((call) => <button type="button" key={call.id} className={`case-file ${selectedCall.id === call.id ? "selected" : ""}`} onClick={() => onSelect(call.id)}><span className="file-icon">◫</span><span><strong>CASE-{call.id}</strong><small>{call.filename || "captured-audio.webm"}</small></span><RiskBadge score={call.urgency} tag={call.tag} /><span className="file-duration">{formatTime(call.duration)}</span><span>›</span></button>)}
        </div>
      </Panel>
    </div>
  );
}

function SettingsDrawer({ open, onClose, piiMode, onTogglePii, reducedMotion, onToggleMotion, autoFollow, onToggleFollow }) {
  if (!open) return null;
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="settings-drawer" role="dialog" aria-modal="true" aria-label="Command center settings" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><p className="eyebrow">LOCAL UI SETTINGS</p><h2>Command preferences</h2></div><button type="button" onClick={onClose} aria-label="Close settings">×</button></header>
        <div className="settings-group">
          <SettingRow label="Mask displayed PII" description="Redact identifiers in the interface only." value={piiMode} onChange={onTogglePii} />
          <SettingRow label="Auto-follow transcript" description="Keep the active segment in view during playback." value={autoFollow} onChange={onToggleFollow} />
          <SettingRow label="Reduced visual motion" description="Minimize waveform animation and glow effects." value={reducedMotion} onChange={onToggleMotion} />
        </div>
        <p className="settings-note">Settings are local to this browser session. They do not modify audio evidence or send data to external services.</p>
      </aside>
    </div>
  );
}

function SettingRow({ label, description, value, onChange }) {
  return <label className="setting-row"><span><strong>{label}</strong><small>{description}</small></span><button type="button" className={`switch ${value ? "on" : ""}`} onClick={onChange} aria-pressed={value}><i /></button></label>;
}

function ConfirmModal({ action, onClose, onConfirm }) {
  if (!action) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(event) => event.stopPropagation()}>
        <span className="modal-icon">!</span>
        <p className="eyebrow">OFFICER CONFIRMATION REQUIRED</p>
        <h2 id="confirm-title">{action.title}</h2>
        <p>{action.description}</p>
        <div className="modal-disclaimer">This prototype logs an in-app operational note only. It does not contact banks, escalate a real case, or make an enforcement decision.</div>
        <footer><button type="button" className="ghost-button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" onClick={onConfirm}>Confirm note</button></footer>
      </div>
    </div>
  );
}

function App() {
  const [calls, setCalls] = useState(FALLBACK_CALLS);
  const [selectedId, setSelectedId] = useState(FALLBACK_CALLS[0].id);
  const [activeView, setActiveView] = useState("overview");
  const [piiMode, setPiiMode] = useState(true);
  const [autoFollow, setAutoFollow] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [events, setEvents] = useState([
    { id: "boot", time: "NOW", tone: "teal", message: "Local signal monitor initialized." },
    { id: "guardrail", time: "NOW", tone: "amber", message: "Responsible AI guardrail acknowledged." },
    { id: "queue", time: "NOW", tone: "pink", message: "Critical UPI fraud call remains first in queue." },
  ]);
  const [audioState, setAudioState] = useState({ currentTime: 0, duration: FALLBACK_CALLS[0].duration, isPlaying: false, error: "" });
  const [isRecording, setIsRecording] = useState(false);
  const [recordElapsed, setRecordElapsed] = useState(0);
  const [captureTranscript, setCaptureTranscript] = useState("");
  const [metadataStatus, setMetadataStatus] = useState("Demo assets ready");

  const audioRef = useRef(null);
  const fileInputRef = useRef(null);
  const selectedIdRef = useRef(selectedId);
  const selectedCallRef = useRef(null);
  const syntheticKeysRef = useRef(new Set());
  const audioContextRef = useRef(null);
  const playbackSourceRef = useRef(null);
  const playbackAnalyserRef = useRef(null);
  const micAnalyserRef = useRef(null);
  const activeAnalyserRef = useRef(null);
  const micSourceRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const captureChunksRef = useRef([]);
  const captureTranscriptRef = useRef("");
  const recognitionRef = useRef(null);
  const recordStartedAtRef = useRef(0);
  const localUrlsRef = useRef(new Set());
  const toastTimerRef = useRef(null);

  const selectedCall = calls.find((call) => call.id === selectedId) || calls[0];
  const currentClock = useKolkataClock();
  const currentDate = currentClock.date;
  const currentTimeLabel = currentClock.time;
  const evidenceHash = useEvidenceHash(selectedCall?.audioUrl);
  const visualTime = isRecording ? recordElapsed : audioState.currentTime;
  const visualDuration = isRecording ? Math.max(8, recordElapsed + 2) : (audioState.duration || selectedCall?.duration || 10);
  const timeline = useMemo(() => makeTelemetry(selectedCall, visualDuration), [selectedCall, visualDuration]);
  const activeFrameIndex = Math.min(timeline.length - 1, Math.max(0, Math.floor(visualTime / HOP_SECONDS)));
  const currentFrame = timeline[activeFrameIndex] || timeline[0];
  const segments = useMemo(() => splitTranscript(selectedCall.transcript, visualDuration), [selectedCall, visualDuration]);
  const activeSegmentIndex = useMemo(() => {
    if (!segments.length) return 0;
    const exact = segments.findIndex((segment) => visualTime >= segment.start && visualTime < segment.end);
    if (exact !== -1) return exact;
    // Before the first boundary keep segment 0; past the final boundary keep the last segment.
    return visualTime >= segments[segments.length - 1].end ? segments.length - 1 : 0;
  }, [segments, visualTime]);

  const announce = useCallback((message, tone = "default") => {
    window.clearTimeout(toastTimerRef.current);
    setToast({ message, tone });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const logEvent = useCallback((message, tone = "teal") => {
    const localTime = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
    setEvents((existing) => [{ id: `${Date.now()}-${message}`, time: localTime, tone, message }, ...existing].slice(0, 10));
  }, []);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    selectedCallRef.current = selectedCall;
  }, [selectedCall]);

  useEffect(() => {
    let mounted = true;
    fetch("/sample_calls/call_metadata.json")
      .then((response) => {
        if (!response.ok) throw new Error("Metadata request failed");
        return response.json();
      })
      .then((metadata) => {
        if (!mounted) return;
        const parsed = normaliseMetadata(metadata);
        if (parsed.length) {
          setCalls(parsed);
          setSelectedId((current) => parsed.some((call) => call.id === current) ? current : parsed[0].id);
          setMetadataStatus("Demo evidence manifest synced");
        }
      })
      .catch(() => {
        if (mounted) setMetadataStatus("Using bundled fallback manifest");
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => () => {
    window.clearTimeout(toastTimerRef.current);
    localUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    try { mediaRecorderRef.current?.stop(); } catch { /* no recorder to stop */ }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    try { audioContextRef.current?.close(); } catch { /* context already closed */ }
  }, []);

  useEffect(() => {
    if (!audioState.isPlaying) return undefined;
    let frame;
    const tick = () => {
      const audio = audioRef.current;
      if (audio && !audio.paused) {
        setAudioState((state) => ({ ...state, currentTime: audio.currentTime }));
        frame = window.requestAnimationFrame(tick);
      }
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [audioState.isPlaying]);

  useEffect(() => {
    if (!isRecording) return undefined;
    let frame;
    const tick = () => {
      setRecordElapsed((Date.now() - recordStartedAtRef.current) / 1000);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [isRecording]);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error("Web Audio API is unavailable");
      audioContextRef.current = new Context();
    }
    return audioContextRef.current;
  }, []);

  const connectPlaybackAnalyser = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return null;
    try {
      const context = getAudioContext();
      if (!playbackSourceRef.current) {
        const source = context.createMediaElementSource(audio);
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.72;
        source.connect(analyser);
        analyser.connect(context.destination);
        playbackSourceRef.current = source;
        playbackAnalyserRef.current = analyser;
      }
      if (context.state === "suspended") await context.resume();
      activeAnalyserRef.current = playbackAnalyserRef.current;
      return playbackAnalyserRef.current;
    } catch {
      // Playback still works through the HTML audio element even if analyser routing is unavailable.
      return null;
    }
  }, [getAudioContext]);

  const togglePlayback = useCallback(async () => {
    if (isRecording) {
      announce("Stop microphone capture before playing evidence audio.", "warning");
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (audioState.isPlaying) {
      audio.pause();
      return;
    }
    try {
      await connectPlaybackAnalyser();
      await audio.play();
      setAudioState((state) => ({ ...state, isPlaying: true, error: "" }));
      logEvent(`Playback started for CASE-${selectedIdRef.current}.`, "teal");
    } catch (error) {
      setAudioState((state) => ({ ...state, isPlaying: false, error: "Playback was blocked or the audio source could not be decoded." }));
      announce("Audio playback could not start. Check the browser permission or choose another file.", "error");
    }
  }, [announce, audioState.isPlaying, connectPlaybackAnalyser, isRecording, logEvent]);

  const seekAudio = useCallback((nextTime) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(nextTime)) return;
    audio.currentTime = nextTime;
    setAudioState((state) => ({ ...state, currentTime: nextTime }));
  }, []);

  const restartAudio = useCallback(() => {
    seekAudio(0);
    logEvent(`Playback rewound for CASE-${selectedIdRef.current}.`, "purple");
  }, [logEvent, seekAudio]);

  const selectCall = useCallback((id) => {
    setSelectedId(id);
    const selected = calls.find((call) => call.id === id);
    if (selected) logEvent(`Focus moved to CASE-${id}: ${selected.crimeType}.`, "teal");
  }, [calls, logEvent]);

  const openMonitor = useCallback((id) => {
    selectCall(id);
    setActiveView("monitor");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [selectCall]);

  const navigate = useCallback((viewId) => {
    setActiveView(viewId);
    window.scrollTo({ top: 0, behavior: "smooth" });
    const navItem = NAV_ITEMS.find((item) => item.id === viewId);
    logEvent(`${navItem?.label || "Command"} view opened.`, "purple");
  }, [logEvent]);

  const updateCallDuration = useCallback((duration) => {
    if (!Number.isFinite(duration) || duration <= 0) return;
    setCalls((existing) => existing.map((call) => call.id === selectedIdRef.current ? { ...call, duration } : call));
  }, []);

  const handleLoadedMetadata = useCallback((event) => {
    const duration = Number(event.currentTarget.duration);
    setAudioState((state) => ({ ...state, duration: Number.isFinite(duration) ? duration : state.duration, error: "" }));
    updateCallDuration(duration);
  }, [updateCallDuration]);

  const handleAudioError = useCallback(() => {
    const audio = audioRef.current;
    const call = selectedCallRef.current;
    if (!audio || !call) {
      setAudioState((state) => ({ ...state, isPlaying: false, error: "The selected audio source could not be loaded." }));
      return;
    }
    const key = `${call.id}:${call.duration}`;
    if (syntheticKeysRef.current.has(key)) {
      setAudioState((state) => ({ ...state, isPlaying: false, error: "Audio could not be decoded by this browser." }));
      return;
    }
    syntheticKeysRef.current.add(key);
    const blob = makeSyntheticWavBlob(call.duration || 10, Number.parseInt(call.id, 10) || 1);
    const url = URL.createObjectURL(blob);
    localUrlsRef.current.add(url);
    audio.src = url;
    audio.load();
    setAudioState((state) => ({ ...state, currentTime: 0, duration: call.duration || 10, error: "" }));
    announce(`Built-in synthetic voice sample generated for CASE-${call.id}.`, "warning");
    logEvent(`Synthetic voice sample generated for CASE-${call.id}.`, "amber");
  }, [announce, logEvent]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !selectedCall?.audioUrl) return undefined;
    audio.pause();
    audio.src = selectedCall.audioUrl;
    audio.load();
    setAudioState({ currentTime: 0, duration: selectedCall.duration || 0, isPlaying: false, error: "" });
    if (activeAnalyserRef.current === playbackAnalyserRef.current) activeAnalyserRef.current = playbackAnalyserRef.current;
    // Safety net: if the bundled asset cannot be decoded in time, swap in a
    // deterministic synthetic voice sample so a demo can always be played.
    const timer = window.setTimeout(() => {
      if (audio.readyState < 2) handleAudioError();
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [selectedCall?.id, selectedCall?.audioUrl, selectedCall?.duration, handleAudioError]);

  const stopRecognition = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { /* recognition was already stopped */ }
    recognitionRef.current = null;
  }, []);

  const stopCaptureStreams = useCallback(() => {
    try { micSourceRef.current?.disconnect(); } catch { /* source already disconnected */ }
    micSourceRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    micAnalyserRef.current = null;
    activeAnalyserRef.current = playbackAnalyserRef.current;
  }, []);

  const startCapture = useCallback(async () => {
    if (isRecording) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      announce("Microphone capture requires a supported browser on localhost or HTTPS.", "error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      captureChunksRef.current = chunks;
      captureTranscriptRef.current = "";
      setCaptureTranscript("Listening for live voice input…");
      recordStartedAtRef.current = Date.now();
      setRecordElapsed(0);

      try {
        const context = getAudioContext();
        if (context.state === "suspended") await context.resume();
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.72;
        source.connect(analyser);
        micSourceRef.current = source;
        micAnalyserRef.current = analyser;
        activeAnalyserRef.current = analyser;
      } catch {
        activeAnalyserRef.current = null;
      }

      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (Recognition) {
        const recognition = new Recognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-IN";
        recognition.onresult = (event) => {
          let interim = "";
          let finalText = "";
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index];
            if (result.isFinal) finalText += result[0].transcript;
            else interim += result[0].transcript;
          }
          const updated = `${captureTranscriptRef.current} ${finalText}`.trim();
          if (finalText) captureTranscriptRef.current = updated;
          setCaptureTranscript(`${updated}${interim ? ` ${interim}` : ""}`.trim() || "Listening for live voice input…");
        };
        recognition.onerror = () => {
          if (!captureTranscriptRef.current) setCaptureTranscript("Voice capture is active. Browser speech-to-text is unavailable for this session.");
        };
        recognition.start();
        recognitionRef.current = recognition;
      } else {
        setCaptureTranscript("Voice capture is active. This browser does not expose offline speech-to-text; audio will still be recorded locally.");
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        announce("Microphone recording encountered an error.", "error");
        stopCaptureStreams();
        setIsRecording(false);
      };
      recorder.onstop = () => {
        stopRecognition();
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const seconds = Math.max(1, (Date.now() - recordStartedAtRef.current) / 1000);
        stopCaptureStreams();
        setIsRecording(false);
        setRecordElapsed(0);
        if (blob.size < 256) {
          announce("No usable microphone audio was captured.", "warning");
          return;
        }
        const audioUrl = URL.createObjectURL(blob);
        localUrlsRef.current.add(audioUrl);
        const id = `local-${Date.now()}`;
        const transcript = captureTranscriptRef.current || "Local microphone recording. Transcription is not available in this browser session.";
        const localCall = applyProfile({
          id,
          filename: `capture-${new Date().toISOString().replace(/[.:]/g, "-")}.webm`,
          audioUrl,
          callerId: "Local microphone capture",
          callerType: "Officer-provided recording",
          crimeType: "Local Audio Review",
          timestamp: new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date()),
          duration: seconds,
          transcript,
          keywords: ["local recording", "human review required"],
          local: true,
          profile: PROFILE_LIBRARY.local,
        });
        setCalls((existing) => [localCall, ...existing]);
        setSelectedId(id);
        setActiveView("monitor");
        announce("Microphone recording saved to the local triage queue.", "success");
        logEvent(`Local microphone capture added as CASE-${id.slice(-6)}.`, "teal");
      };
      recorder.start(250);
      setIsRecording(true);
      announce("Microphone capture started. Speak normally; visual telemetry is live.", "success");
      logEvent("Live microphone capture started.", "red");
    } catch (error) {
      stopCaptureStreams();
      announce("Microphone permission was denied or no input device is available.", "error");
    }
  }, [announce, getAudioContext, isRecording, logEvent, stopCaptureStreams, stopRecognition]);

  const stopCapture = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
    announce("Finalizing local microphone recording…", "default");
  }, [announce]);

  const handleUpload = useCallback((event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("audio/") && !/\.(wav|mp3|ogg|m4a|webm|flac|aiff?)$/i.test(file.name)) {
      announce("Select a supported audio file such as WAV, MP3, OGG, M4A, or WebM.", "error");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      announce("Audio upload exceeds the 25 MB local review limit.", "warning");
      return;
    }
    const audioUrl = URL.createObjectURL(file);
    localUrlsRef.current.add(audioUrl);
    const id = `upload-${Date.now()}`;
    const uploadCall = applyProfile({
      id,
      filename: file.name,
      audioUrl,
      callerId: "Local upload",
      callerType: "Officer-provided audio",
      crimeType: "Uploaded Audio Review",
      timestamp: "LOCAL",
      duration: 0,
      transcript: "Uploaded audio is ready for playback. Use the live monitor for local waveform review. A server-side DSP endpoint can be added when production analysis is required.",
      keywords: ["uploaded audio", "local review"],
      local: true,
      profile: PROFILE_LIBRARY.local,
    });
    setCalls((existing) => [uploadCall, ...existing]);
    setSelectedId(id);
    setActiveView("monitor");
    announce(`${file.name} was added to the local triage queue.`, "success");
    logEvent(`Local audio upload added: ${file.name}.`, "teal");
  }, [announce, logEvent]);

  const requestAction = useCallback((title, description) => setConfirmAction({ title, description }), []);
  const confirmActionHandler = useCallback(() => {
    if (!confirmAction) return;
    logEvent(`${confirmAction.title} — officer note confirmed.`, "amber");
    announce("Action recorded locally for officer follow-up.", "success");
    setConfirmAction(null);
  }, [announce, confirmAction, logEvent]);

  const copyHash = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(evidenceHash);
      announce("Integrity hash copied to clipboard.", "success");
    } catch {
      announce("Clipboard access is unavailable. Select and copy the hash manually.", "warning");
    }
  }, [announce, evidenceHash]);

  const downloadBrief = useCallback(() => {
    const payload = {
      generatedAt: new Date().toISOString(),
      caseId: selectedCall.id,
      callType: selectedCall.crimeType,
      callerType: selectedCall.callerType,
      urgency: Math.round(currentFrame.urgency),
      acousticFrame: currentFrame.features,
      emotionIndicators: currentFrame.emotions,
      keywords: selectedCall.keywords,
      integrityHash: evidenceHash,
      advisory: "Emotion predictions are indicative acoustic signals for call prioritization and victim support only. They do not constitute evidence of intent, honesty, deception, or legal guilt.",
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cyberser-case-${selectedCall.id}-brief.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    announce("Case brief downloaded as a local JSON file.", "success");
    logEvent(`Case brief exported for CASE-${selectedCall.id}.`, "purple");
  }, [announce, currentFrame, evidenceHash, logEvent, selectedCall]);

  const monitorProps = {
    call: selectedCall,
    currentTime: visualTime,
    duration: visualDuration,
    isPlaying: audioState.isPlaying,
    isRecording,
    currentFrame,
    timeline,
    analyserRef: activeAnalyserRef,
    onTogglePlayback: togglePlayback,
    onSeek: seekAudio,
    onRestart: restartAudio,
    audioUnavailable: Boolean(audioState.error),
    events,
  };

  let content;
  if (activeView === "queue") {
    content = <QueueView calls={calls} selectedId={selectedId} onSelect={selectCall} onOpenMonitor={openMonitor} onAction={requestAction} />;
  } else if (activeView === "monitor") {
    content = <div className="view-stack"><MonitorPanel {...monitorProps} /><div className="telemetry-layout monitor-detail-layout"><Panel eyebrow="LIVE WINDOWED TELEMETRY" title="Emotion trajectory"><EmotionTimeline timeline={timeline} currentTime={visualTime} duration={visualDuration} /></Panel><Panel eyebrow="MFCC / SPECTRAL ENERGY" title="Voice texture"><MfccHeatmap currentTime={visualTime} duration={visualDuration} /><p className="mfcc-note"><span /> Active column follows audio or microphone time.</p></Panel></div><TranscriptPanel segments={segments} activeIndex={activeSegmentIndex} piiMode={piiMode} keywords={selectedCall.keywords} autoFollow={autoFollow} onTogglePii={() => setPiiMode((value) => !value)} isRecording={isRecording} captureTranscript={captureTranscript} /><MetricsStrip frame={currentFrame} /></div>;
  } else if (activeView === "intelligence") {
    content = <IntelligenceView call={selectedCall} currentFrame={currentFrame} timeline={timeline} currentTime={visualTime} duration={visualDuration} piiMode={piiMode} onTogglePii={() => setPiiMode((value) => !value)} />;
  } else if (activeView === "cases") {
    content = <CaseFilesView calls={calls} selectedCall={selectedCall} evidenceHash={evidenceHash} onDownload={downloadBrief} onCopyHash={copyHash} onSelect={selectCall} onAction={requestAction} />;
  } else {
    content = <OverviewView calls={calls} selectedId={selectedId} onSelect={selectCall} onOpenMonitor={openMonitor} {...monitorProps} />;
  }

  return (
    <div className={`app-shell ${reducedMotion ? "reduced-motion" : ""}`}>
      <audio
        ref={audioRef}
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={(event) => setAudioState((state) => ({ ...state, currentTime: event.currentTarget.currentTime }))}
        onPlay={() => setAudioState((state) => ({ ...state, isPlaying: true, error: "" }))}
        onPause={() => setAudioState((state) => ({ ...state, isPlaying: false }))}
        onEnded={() => { setAudioState((state) => ({ ...state, isPlaying: false, currentTime: state.duration })); logEvent(`Playback completed for CASE-${selectedIdRef.current}.`, "teal"); }}
        onError={handleAudioError}
      />
      <Sidebar activeView={activeView} onNavigate={navigate} queueSize={calls.length} isRecording={isRecording} />
      <main className="main-stage">
        <header className="topbar">
          <div className="topbar-title"><p className="eyebrow">SECURITY OPERATIONS / AUDIO INTELLIGENCE</p><h1>{NAV_ITEMS.find((item) => item.id === activeView)?.label || "Command"} <em>Command</em></h1><span>{metadataStatus}</span></div>
          <nav className="topbar-nav" aria-label="Quick view switcher">
            {NAV_ITEMS.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`topbar-tab ${activeView === item.id ? "active" : ""}`}
                onClick={() => navigate(item.id)}
                aria-current={activeView === item.id ? "page" : undefined}
              >
                <span className="tab-icon" aria-hidden="true">{item.icon}</span>
                {item.label}
                {item.id === "queue" && <span className="tab-badge">{String(calls.length).padStart(2, "0")}</span>}
              </button>
            ))}
          </nav>
          <div className="topbar-actions">
            <div className="live-clock-synced" title="Live IST system clock, synced every second">
              <span className="live-pulse" />
              <span className="clock-digits">{currentTimeLabel}</span>
              <span className="clock-meta"><span className="clock-date">{currentDate}</span><span className="clock-tz">IST · LIVE</span></span>
            </div>
            <button type="button" className="header-action upload-action" onClick={() => fileInputRef.current?.click()}><span>＋</span> Import audio</button>
            <button type="button" className={`header-action record-action ${isRecording ? "recording" : ""}`} onClick={isRecording ? stopCapture : startCapture}><span>{isRecording ? "■" : "●"}</span>{isRecording ? " Stop capture" : " Mic capture"}</button>
            <button type="button" className="settings-button" onClick={() => setSettingsOpen(true)} aria-label="Open command preferences">⚙</button>
          </div>
        </header>

        <KpiRibbon calls={calls} selectedCall={selectedCall} currentFrame={currentFrame} isRecording={isRecording} />
        <div className="command-toolbar">
          <div><span>FOCUSED CASE</span><strong>CASE-{selectedCall.id} · {selectedCall.crimeType}</strong></div>
          <div className="command-actions"><button type="button" onClick={() => requestAction("Escalate to senior cyber officer", "Create an officer-reviewed escalation note for the selected case.")}>↗ Escalate</button><button type="button" onClick={() => requestAction("Golden-hour bank freeze recommendation", "Create a recommendation note only. A human must independently verify the event and follow authorized bank procedures.")}>⌁ Bank freeze</button><button type="button" onClick={() => requestAction("Voiceprint watchlist review", "Create a review note. This prototype does not identify, match, or flag any real person.")}>◌ Watchlist review</button></div>
        </div>

        {content}
      </main>
      <input ref={fileInputRef} type="file" accept="audio/*,.wav,.mp3,.ogg,.m4a,.webm,.flac,.aif,.aiff" onChange={handleUpload} hidden />
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} piiMode={piiMode} onTogglePii={() => setPiiMode((value) => !value)} reducedMotion={reducedMotion} onToggleMotion={() => setReducedMotion((value) => !value)} autoFollow={autoFollow} onToggleFollow={() => setAutoFollow((value) => !value)} />
      <ConfirmModal action={confirmAction} onClose={() => setConfirmAction(null)} onConfirm={confirmActionHandler} />
      {toast && <div className={`toast ${toast.tone}`} role="status"><span>{toast.tone === "error" ? "!" : toast.tone === "warning" ? "!" : "✓"}</span>{toast.message}</div>}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
