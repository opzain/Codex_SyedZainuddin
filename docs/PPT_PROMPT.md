# CyberSER — Complete PowerPoint Generation Prompt

Copy everything between the `---` markers into your AI slide generator (Gamma, ChatGPT + Slides, Copilot, Canva Magic, Beautiful.ai). Fill the bracketed placeholders first.

---

## ROLE

You are a senior presentation designer and technical storyteller. You build investor-grade, hackathon-winning decks: crisp narrative, one idea per slide, no walls of text, strong visual hierarchy.

## TASK

Create a complete, presentation-ready **16:9 PowerPoint deck** of **15 slides** for the project below. Deliver a real `.pptx` if your tool supports it; otherwise deliver slide-by-slide copy plus a precise visual description for each slide.

## AUDIENCE & OCCASION

- Audience: cybercrime investigators, police/cyber-cell officers, faculty judges, and technical reviewers at a final-year project / hackathon demo.
- Speaking time: **10–12 minutes** (≈40–50 seconds per slide) + 3 minutes Q&A.
- Goal of the deck, in one sentence: *convince the audience that a live, audio-first triage console can cut the time between a distress call and the right human action, without automating guilt or surveillance.*

## SOURCE OF TRUTH (do not contradict, do not invent numbers)

**Project name:** CyberSER — Real-Time Speech Emotion Analysis for Cybercrime Investigation
**One-liner:** An audio-first SOC command center that turns a cybercrime helpline call into a prioritized, human-reviewed case in seconds.

**Problem**
- Cybercrime helpline officers handle many simultaneous calls with no objective way to rank distress and urgency.
- The "golden hour" after fraud (UPI transfer, SIM clone, account takeover) decides whether money can be frozen.
- Existing tools are either transcription-only or full of unvalidated "lie detector" claims.

**Solution — five workspaces in one console**
1. **Overview** — live priority intake, tactical recommendations, operational event bus.
2. **Triage Queue** — every call ranked by composite urgency with trigger keywords.
3. **Live Monitor** — evidence playback, live waveform, urgency gauge, emotion radar, emotion timeline, MFCC heatmap, synced transcript.
4. **Intelligence** — explainable "why this call is prioritized" signal fusion.
5. **Case Files** — chain-of-custody SHA-256 fingerprint, privacy status, local case index.

**How the analysis works (keep it honest)**
- 250 ms analysis frames, 500 ms windows.
- Features: F0/pitch, jitter, RMS energy, spectral centroid, 13-band MFCC, speech rate.
- Emotion estimates: distress, fear, anger, nervousness, calm → composite urgency score 0–100.
- Priority bands: CRITICAL 80–100 (golden hour), HIGH 60–79, MODERATE 40–59, LOW 0–39.
- Explicitly: these are assistive stress indicators, **not** deception detection, **not** proof of victimhood, **not** legal evidence.

**Live experience (what a judge actually sees)**
- Working navigation from both the sidebar and the header quick-nav tabs; view, heading and tab stay in sync.
- Real audio playback: play/pause, seek, restart; live waveform driven by a Web Audio API analyser.
- Emotion radar and emotion timeline move with the audio playhead; active transcript segment highlights in sync.
- Live IST clock (HH:MM:SS + date) refreshed every second.
- Microphone capture with browser speech-to-text streaming into the live transcript.
- If a browser cannot decode an audio file, a deterministic synthetic voice sample is generated locally so the demo never dies.
- PII redaction toggle (display-level masking) and a human-confirmation modal before any operational note.

**Demo assets (four calls)**
1. `101` — UPI fraud victim, distressed, 12 s, CRITICAL / golden hour.
2. `102` — ransomware informant tip, nervous, 10 s, HIGH.
3. `103` — angry account-compromise victim, 11 s, HIGH.
4. `104` — suspected vishing / social-engineering caller, 10 s, MODERATE.

**Engineering**
- Frontend: React 19 + Vite 8, hand-built CSS design system, Web Audio API, MediaRecorder, SpeechRecognition.
- Analysis engine: Python 3, NumPy + librosa/SoundFile (optional Streamlit legacy console).
- Repo: `github.com/opzain/Codex_SyedZainuddin` — 25 files, MIT-style demo assets generated locally.
- **Live deployment:** `https://cyberser-command-center.onrender.com` (Render static site, auto-built from `main`).
- **Verification:** 44 automated DOM/interaction assertions (jsdom) all passing; production build in ~0.6 s.

**Responsible AI (must appear on its own slide)**
- Indicators prioritize support, not suspicion. No deception, intent, or guilt inference.
- Human-in-the-loop: every escalation is a note for an officer to verify.
- PII masked in the interface; audio never leaves the device in the demo.
- Model limits stated openly: emotion inference is noisy and culturally dependent.

**Roadmap**
- Real ASR/NLP fusion with calibrated, validated SER model.
- Multilingual support (Hindi, Marathi, Hinglish) and telephony/SIP ingestion.
- Immutable audit log, role-based access, retention controls aligned to India's DPDP Act.
- Officer feedback loop to calibrate urgency thresholds per crime type.

**Team:** [YOUR NAME] — [ROLE, e.g. Full-stack & DSP] · [TEAM MEMBER 2] · [TEAM MEMBER 3]
**Institution:** [COLLEGE / ORGANISATION] · **Date:** [DATE] · **Contact:** [EMAIL / LINKEDIN]

## DESIGN SYSTEM

- Mood: calm cyber-operations room at night — precise, dark, confident. Not neon-gaming, not sci-fi cliché.
- Background: near-black navy `#060D18`; panels `#0A1C2C` with 1 px borders `rgba(111,166,193,0.18)`.
- Primary accent: teal `#52E8C5`. Secondary: cyan `#5AC8FF`, purple `#AF91FF`, amber `#FFD06D`, alert red `#FF547B`.
- Text: near-white `#EEF8FF`; muted `#7997AC`.
- Typography: **Space Grotesk** for headings, **DM Mono** for labels, metrics and timestamps.
- Texture: subtle grid lines, thin data rules, tiny uppercase eyebrow labels above each headline.
- Imagery: use real product screenshots of the console as the hero visual on at least 5 slides; no generic stock "hacker" photos.
- Motion (if your tool animates): playhead sweeping across a waveform; radar polygon morphing; numbers counting up.

## SLIDE-BY-SLIDE SPECIFICATION

Follow this order exactly. For each slide provide: title, eyebrow label, 3–5 bullets (≤12 words each), one visual direction, and 2–3 sentences of speaker notes.

1. **Title** — "CyberSER" / "Every second of a cybercrime call is evidence." Subtitle: Real-time speech emotion analysis for cybercrime triage. Team, institution, date. Visual: full-bleed dark console screenshot with teal glow.
2. **The problem** — A helpline queue with no objective priority; the golden hour is lost while calls wait. Visual: three stacked call cards with no ranking, one quietly decaying timer.
3. **Why existing tools fail** — Transcription without urgency; "lie detectors" that overclaim; dashboards that are static mockups. Visual: three crossed-out generic tool icons.
4. **The insight** — Voice carries measurable stress cues, and stress + semantics can rank *support priority* — not guilt. Visual: single waveform resolving into an ordered queue.
5. **Solution overview** — One console, five workspaces, from intake to case file. Visual: annotated product screenshot with five numbered hotspots.
6. **Live demo: the audio** — Play a real call; waveform, playhead and transport behave like a real evidence player. Visual: large waveform panel with timecode.
7. **Live demo: the signals** — Radar, timeline, MFCC and urgency gauge all move with the same clock. Visual: four-panel mosaic with a shared playhead line.
8. **Live demo: the transcript** — Segments highlight as the caller speaks; keywords surface; PII masked. Visual: transcript panel, active segment highlighted teal, redaction chips.
9. **Under the hood** — 250 ms frames → features → emotion estimates → urgency 0–100 → priority band. Visual: clean 5-step horizontal pipeline diagram.
10. **Explainability** — Every score shows its reasons: pitch instability, semantic triggers, time-sensitivity. Visual: split panel "score 96" with three ranked reasons.
11. **Responsible AI** — Indicators are not determinations; human-in-the-loop; local-first; documented limits. Visual: four-quadrant guardrail cards, one with a subtle lock icon.
12. **Engineering & verification** — React + Vite, Python DSP engine, 44/44 automated interaction checks, production build 0.6 s. Visual: architecture diagram (browser → Web Audio → engine → UI) with test badge.
13. **Deployment** — Live on Render at the public URL, auto-deployed from GitHub `main`. Visual: QR code to the live URL + repo URL in mono type.
14. **Impact & roadmap** — Faster triage, consistent prioritization, auditable decisions; next: ASR fusion, multilingual, telephony, DPDP-aligned retention. Visual: two-column "now / next" with a horizontal timeline.
15. **Close** — "Rank the call, not the person." Thank you, live URL, repo, contact. Visual: minimal dark slide, single teal line, waveform fading out.

## WRITING RULES

- Maximum 6 bullets per slide; maximum 12 words per bullet.
- One idea per slide; the title alone should tell the story.
- Prefer concrete numbers and verbs over adjectives: "250 ms frames", "44/44 checks", "freeze within the golden hour".
- Never claim the system detects lies, deception, or guilt.
- Spell out acronyms on first use (SER, MFCC, F0, PII, SOC, DPDP).
- Speaker notes: conversational, first person plural, include a transition sentence into the next slide.

## OUTPUT FORMAT

- 16:9 widescreen, 1920×1080.
- Fully editable text boxes and shapes; consistent master slide, footer with slide number and project name.
- Include a final **Appendix: sources & disclaimers** slide after slide 15 with the Render URL, GitHub URL, and the responsible-AI statement.
- Export a `.pptx` and a `.pdf`. Name files `CyberSER_Deck_v1.pptx` and `CyberSER_Deck_v1.pdf`.

## QUALITY CHECK BEFORE YOU RETURN

1. Could a non-technical judge explain the project after slide 5?
2. Is there at least one real product screenshot on every demo slide?
3. Does every claim trace back to the source of truth above?
4. Are the responsible-AI limits visible, not buried?
5. Is any slide over 60 words? If yes, cut it.
6. Are the live URL and repo URL correct and clickable?

---
