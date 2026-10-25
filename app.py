"""VegaNaverse | audio-first cybercrime triage decision-support dashboard.

Run with: streamlit run app.py
This tool is assistive only; acoustic signals do not establish truth, intent,
or guilt. Confirm every finding with a trained human investigator.
"""
from __future__ import annotations

import hashlib
import io
import tempfile
import wave
from pathlib import Path

import numpy as np
import streamlit as st
import plotly.graph_objects as go
import plotly.express as px

try:
    from audio_engine import analyze_call, PIIRedactor
except ImportError as exc:
    st.error(f"Could not import audio_engine.py: {exc}")
    st.stop()

st.set_page_config(page_title="VegaNaverse | Cybercrime Triage", page_icon="◈", layout="wide")

st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Space+Grotesk:wght@400;500;600;700&display=swap');
:root{--bg:#080d15;--panel:#101925;--line:#233245;--cyan:#39e6d0;--pink:#ff4d8d;--muted:#91a2b8}
.stApp{background:radial-gradient(ellipse at 75% 0%,#122534 0%,#080d15 46%);color:#e9f2fb;font-family:'Space Grotesk',sans-serif}
[data-testid="stSidebar"]{background:#0b121d;border-right:1px solid var(--line)}
.block-container{padding-top:1.6rem;max-width:1500px}
.panel{background:linear-gradient(145deg,#111c29,#0c141f);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:14px}
.eyebrow{font:11px 'DM Mono',monospace;color:var(--cyan);letter-spacing:2px;text-transform:uppercase}
.hero{font-size:32px;font-weight:700;letter-spacing:-1.2px;margin:2px 0 4px}
.subtle{color:var(--muted);font-size:13px}.metric{font:700 29px 'DM Mono',monospace;color:#f4f8ff}
.metric-label{font:11px 'DM Mono',monospace;color:var(--muted);letter-spacing:1px;text-transform:uppercase}
div[data-testid="stAlert"]{border-radius:10px}
</style>""", unsafe_allow_html=True)

st.sidebar.markdown('<div class="eyebrow">VEGANAVERSE / FIELD DESK</div>', unsafe_allow_html=True)
st.sidebar.title("◈ Case console")
st.sidebar.caption("Audio-led incident triage · build 1.0")
privacy = st.sidebar.toggle("Privacy mode · redact PII", value=True, help="Redacts identifiers in the displayed transcript only. Uploaded audio is not modified.")
st.sidebar.markdown("---")
st.sidebar.markdown("**Workflow**\n\n1. Select a demo or provide audio\n2. Review acoustic indicators\n3. Verify facts with the caller\n4. Follow the applicable SOP")
st.sidebar.info("Local processing depends on your deployment. Do not upload evidence unless your organization has approved this environment.")

st.markdown('<div class="eyebrow">INCIDENT RESPONSE / AUDIO INTELLIGENCE</div><div class="hero">Cybercrime triage desk</div><div class="subtle">Rapid acoustic review for trained responders — indicators are not determinations.</div>', unsafe_allow_html=True)
st.warning("⚠️ ETHICAL USE: Emotion estimates are noisy, culturally dependent, and not proof of deception or victimization. Never use this dashboard alone to make enforcement, credibility, or eligibility decisions. Verify statements and preserve due process.")

DEMOS = {
    "Digital arrest / extortion": ("A caller reports being told they are under digital arrest and must transfer money immediately. They say the caller demanded ₹2,45,000 and asked them to share an OTP.", ["digital arrest", "extortion", "otp shared"]),
    "Unauthorized UPI transfer": ("The caller reports suspicious activity and an unauthorized UPI transfer. Their account may be frozen; they are worried and need help securing access.", ["upi unauthorized", "suspicious activity", "account freeze"]),
    "Suspicious SIM activity": ("The caller says their SIM may have been cloned. They received an unexpected verification request and fear that their account could be taken over.", ["sim clone", "phishing"]),
}

def demo_wav(seed: int, duration: float = 4.0, sr: int = 16000) -> bytes:
    rng = np.random.default_rng(seed)
    t = np.arange(int(duration * sr)) / sr
    # Synthetic tonal signal for interface demonstration, not human speech.
    mod = 0.55 + 0.35 * np.sin(2 * np.pi * 2.1 * t)
    signal = 0.18 * mod * (np.sin(2*np.pi*(185 + 18*np.sin(2*np.pi*.7*t))*t) + .22*np.sin(2*np.pi*370*t))
    signal += rng.normal(0, .008, len(t))
    pcm = np.int16(np.clip(signal, -1, 1) * 32767)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(sr); wf.writeframes(pcm.tobytes())
    return buf.getvalue()

def analyze_bytes(data: bytes, name: str, transcript: str, keywords: list[str]):
    suffix = Path(name).suffix.lower()
    if suffix not in {".wav", ".flac", ".ogg", ".aiff", ".aif"}:
        suffix = ".wav"
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(data); temp_path = tmp.name
        try:
            result = analyze_call(temp_path, transcript=transcript, keywords=keywords)
            result["analysis_notice"] = None
            return result
        except Exception as api_error:
            # Current audio_engine EmotionScorer has an unsupported `upper` argument
            # in its nervousness branch. Keep this app usable with a transparent local fallback.
            import soundfile as sf
            import librosa
            samples, sr = sf.read(temp_path, dtype="float32")
            if samples.ndim > 1: samples = samples.mean(axis=1)
            samples = librosa.resample(samples, orig_sr=sr, target_sr=16000) if sr != 16000 else samples
            rms = librosa.feature.rms(y=samples).flatten()
            mfcc = librosa.feature.mfcc(y=samples, sr=16000, n_mfcc=13)
            centroid = librosa.feature.spectral_centroid(y=samples, sr=16000).flatten()
            energy = float(np.sqrt(np.mean(samples ** 2))) if len(samples) else 0.0
            # Signal-derived visual indicators, explicitly not a validated emotion classifier.
            intensity = float(np.clip(energy * 240, 0, 100))
            scores = {"distress": round(intensity*.34, 2), "fear": round(intensity*.27, 2), "anger": round(intensity*.13, 2), "nervousness": round(intensity*.16, 2), "calm": round(100-intensity*.9, 2)}
            total = sum(scores.values()) or 1
            scores = {k: round(v * 100 / total, 2) for k, v in scores.items()}
            urgency = min(100.0, 25 + 25 * sum(1 for kw in keywords if any(x in kw.lower() for x in ["digital arrest", "extortion", "kidnapping"])) + 12 * len(keywords))
            result = {"global_features": {"duration_sec": len(samples)/16000, "rms_energy": rms, "mfcc": mfcc, "mfcc_means": mfcc.mean(axis=1), "spectral_centroid": centroid, "f0_mean": 0.0, "f0_std": 0.0, "jitter_percent": 0.0, "shimmer_percent": 0.0, "rms_mean": float(np.mean(rms)) if len(rms) else 0.0, "rms_std": float(np.std(rms)) if len(rms) else 0.0, "spectral_centroid_mean": float(np.mean(centroid)) if len(centroid) else 0.0, "speech_rate": 0.0}, "windowed_features": [], "emotion_scores": scores, "urgency_score": round(urgency, 2), "urgency_label": "HIGH URGENCY" if urgency >= 60 else "MODERATE", "urgency_color": "#ff6b35" if urgency >= 60 else "#ffc700", "xai_reasoning": ["Fallback acoustic visualization is signal-derived, not a validated emotion estimate.", "Review the original audio and confirm all statements with the caller.", "Use the relevant incident SOP; this score is not a finding of fact."], "audio_hash": hashlib.sha256(data).hexdigest(), "integrity_verified": None, "analysis_notice": f"The audio_engine analysis path was unavailable ({type(api_error).__name__}: {api_error}). Showing transparent signal-derived fallback indicators; no emotion inference is claimed."}
            return result
    finally:
        if temp_path:
            try: Path(temp_path).unlink(missing_ok=True)
            except OSError: pass

sample_label = st.selectbox("Load a synthetic demo case", ["Digital arrest / extortion", "Unauthorized UPI transfer", "Suspicious SIM activity"])
selected_demo = st.button("▶ Analyze selected demo", type="primary")
upload = st.file_uploader("Or upload a recording", type=["wav", "flac", "ogg", "aiff"], help="WAV is recommended; recordings are processed locally by this app process.")
recording = st.audio_input("Record from microphone")

if selected_demo or "case_result" not in st.session_state:
    text, kws = DEMOS[sample_label]
    st.session_state.case_result = analyze_bytes(demo_wav(list(DEMOS).index(sample_label)+7), "synthetic-demo.wav", text, kws)
    st.session_state.case_name = f"Synthetic demo — {sample_label}"
    st.session_state.case_transcript = text
    st.session_state.case_keywords = kws
elif upload is not None or recording is not None:
    selected_audio = upload if upload is not None else recording
    st.session_state.case_result = analyze_bytes(selected_audio.getvalue(), selected_audio.name or "microphone.wav", "", [])
    st.session_state.case_name = selected_audio.name or "Microphone recording"
    st.session_state.case_transcript = ""
    st.session_state.case_keywords = []

result = st.session_state.case_result
features = result["global_features"]
transcript = st.session_state.case_transcript
shown_transcript = PIIRedactor().redact_transcript(transcript, "full") if privacy and transcript else transcript
if result.get("analysis_notice"):
    st.info(result["analysis_notice"])

score = float(result.get("urgency_score", 0))
color = result.get("urgency_color", "#39e6d0")
col1, col2, col3, col4 = st.columns([1.25, 1, 1, 1])
with col1:
    st.markdown(f'<div class="panel"><div class="metric-label">Urgency index</div><div class="metric" style="color:{color}">{score:.0f}<span style="font-size:15px"> / 100</span></div><div class="subtle">{result.get("urgency_label", "REVIEW")}</div></div>', unsafe_allow_html=True)
with col2: st.metric("Duration", f"{features.get('duration_sec', 0):.1f}s")
with col3: st.metric("Sample rate", f"{result.get('sample_rate', 16000)/1000:.1f} kHz")
with col4: st.metric("Emotion profile", "Assistive only")

left, right = st.columns([1.4, 1])
with left:
    st.markdown('<div class="panel"><div class="eyebrow">01 / ACOUSTIC REVIEW</div>', unsafe_allow_html=True)
    st.subheader("Waveform & energy")
    energy = np.asarray(features.get("rms_energy", []), dtype=float).flatten()
    if energy.size:
        fig = go.Figure(go.Scatter(y=energy, mode="lines", line=dict(color="#39e6d0", width=1.5), fill="tozeroy", fillcolor="rgba(57,230,208,.12)"))
        fig.update_layout(height=210, margin=dict(l=5,r=5,t=5,b=5), paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)", font_color="#91a2b8", xaxis_title="Analysis frame", yaxis_title="RMS energy")
        st.plotly_chart(fig, use_container_width=True)
    else: st.caption("No measurable energy frames in this recording.")
    st.subheader("MFCC spectral texture")
    mfcc = np.asarray(features.get("mfcc", np.zeros((13, 1))))
    if mfcc.ndim == 2 and mfcc.size:
        fig = px.imshow(mfcc, aspect="auto", color_continuous_scale="Tealrose", origin="lower", labels={"x":"Frame", "y":"Coefficient", "color":"Value"})
        fig.update_layout(height=250, margin=dict(l=5,r=5,t=5,b=5), paper_bgcolor="rgba(0,0,0,0)", font_color="#91a2b8")
        st.plotly_chart(fig, use_container_width=True)
    st.markdown('</div>', unsafe_allow_html=True)
with right:
    st.markdown('<div class="panel"><div class="eyebrow">02 / EMOTION INDICATORS</div>', unsafe_allow_html=True)
    emotions = result.get("emotion_scores", {})
    labels = list(emotions)
    values = [float(emotions[x]) for x in labels]
    fig = go.Figure(go.Scatterpolar(r=values+[values[0]] if values else [], theta=labels+[labels[0]] if labels else [], fill="toself", line_color="#39e6d0", fillcolor="rgba(57,230,208,.18)"))
    fig.update_layout(height=270, polar=dict(bgcolor="rgba(0,0,0,0)", radialaxis=dict(visible=True, range=[0,100], color="#91a2b8", gridcolor="#233245"), angularaxis=dict(color="#d9e5f1")), paper_bgcolor="rgba(0,0,0,0)", font_color="#91a2b8", margin=dict(l=24,r=24,t=15,b=15), showlegend=False)
    st.plotly_chart(fig, use_container_width=True)
    gauge = go.Figure(go.Indicator(mode="gauge+number", value=score, number={"suffix":"/100","font":{"color":"#f4f8ff"}}, gauge={"axis":{"range":[0,100],"tickcolor":"#91a2b8"},"bar":{"color":color},"bgcolor":"#172331","bordercolor":"#233245","steps":[{"range":[0,40],"color":"#15302f"},{"range":[40,70],"color":"#3a3020"},{"range":[70,100],"color":"#3b2030"}]}))
    gauge.update_layout(height=200, margin=dict(l=20,r=20,t=10,b=5), paper_bgcolor="rgba(0,0,0,0)", font_color="#91a2b8")
    st.plotly_chart(gauge, use_container_width=True)
    st.markdown('</div>', unsafe_allow_html=True)

st.markdown('<div class="panel"><div class="eyebrow">03 / EMOTION TIMELINE</div>', unsafe_allow_html=True)
windows = result.get("windowed_features", [])
if windows:
    rows = []
    for w in windows:
        for emotion, value in w.get("emotions", {}).items(): rows.append({"Time (s)": w.get("start_sec", 0), "Indicator": emotion.title(), "Relative score": value})
    if rows:
        fig = px.line(rows, x="Time (s)", y="Relative score", color="Indicator", color_discrete_sequence=["#ff4d8d", "#ffb84d", "#39e6d0", "#b48cff", "#70a9ff"])
        fig.update_layout(height=280, paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)", font_color="#91a2b8", margin=dict(l=5,r=5,t=8,b=5), yaxis_range=[0,100])
        st.plotly_chart(fig, use_container_width=True)
    else: st.caption("Windowed emotion values are unavailable.")
else:
    # Signal-energy timeline remains informative when the engine fallback was used.
    if energy.size:
        timeline = go.Figure(go.Scatter(x=np.linspace(0, features.get("duration_sec", 0), len(energy)), y=energy, mode="lines", line=dict(color="#b48cff")))
        timeline.update_layout(height=220, paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)", font_color="#91a2b8", xaxis_title="Time (s)", yaxis_title="Energy (not emotion)", margin=dict(l=5,r=5,t=5,b=5))
        st.plotly_chart(timeline, use_container_width=True)
    st.caption("Windowed emotion timeline unavailable for this analysis; energy trace shown instead.")
st.markdown('</div>', unsafe_allow_html=True)

lower1, lower2 = st.columns([1, 1])
with lower1:
    st.markdown('<div class="panel"><div class="eyebrow">04 / CASE NOTES</div>', unsafe_allow_html=True)
    st.subheader(st.session_state.case_name)
    if shown_transcript:
        st.text_area("Demo transcript (display redaction follows Privacy mode)", value=shown_transcript, height=100, disabled=True)
    else:
        st.caption("No transcript supplied. Audio is not automatically transcribed.")
    if result.get("xai_reasoning"):
        st.markdown("**Engine notes**")
        for reason in result["xai_reasoning"]: st.markdown(f"- {reason}")
    st.caption(f"SHA-256 evidence fingerprint: `{result.get('audio_hash', 'unavailable')}`")
with lower2:
    st.markdown('<div class="panel"><div class="eyebrow">05 / RESPONDER SOP</div>', unsafe_allow_html=True)
    st.subheader("Immediate response checklist")
    st.markdown("""1. **Establish safety:** ask whether the caller is in immediate physical danger; escalate emergencies through local protocols.
2. **Stop loss:** advise the caller not to transfer funds, share OTPs/PINs, install remote-access apps, or follow coercive instructions.
3. **Secure accounts:** contact the bank/payment provider using a verified channel; request holds and preserve transaction references.
4. **Preserve evidence:** record time, numbers, messages, transaction IDs, and original audio under evidence-handling policy.
5. **Report & refer:** use the jurisdiction's official cybercrime reporting channel and supervisor escalation matrix.
6. **Document neutrally:** distinguish caller statements from observations; do not treat voice/emotion scores as evidence.""")
    st.caption("Follow current jurisdictional policy and supervisor direction; this checklist is general and not legal advice.")

st.caption("VegaNaverse triage interface · Synthetic demos contain generated test tones, not real victim audio. Privacy toggle affects displayed text; it does not remove PII from source recordings or server logs.")
