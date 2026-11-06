# CyberSER — Judge Briefing Pack

Everything the team needs to present: problem, build, models, evidence, demo script, and
answers to the questions judges actually ask. Numbers here are the ones we measured in this
repository — do not inflate them on stage.

---

## 1. The 60-second pitch

> A cybercrime helpline receives many callers at once, and the officer has no objective way to
> decide who is in the most danger. The first hour after a UPI fraud or a SIM swap decides
> whether the money can still be frozen. CyberSER is an audio-first triage console: it plays the
> call, shows acoustic stress indicators and the spoken transcript on one screen, ranks every
> case by a composite urgency score, and exports a hash-verified case brief. Every escalation
> stays a recommendation for a human officer. We built and deployed the full workflow — live at
> `cyberser-command-center.onrender.com` — and we are explicit about what is measured and what
> is still simulated.

---

## 2. Problem statement

**Who hurts:** cybercrime helpline officers and the callers waiting in a queue.

**What hurts:**
- Calls arrive faster than officers can assess them; triage is subjective and inconsistent.
- The "golden hour" after unauthorized transfer, SIM swap, or account takeover is when a freeze
  can still recover money. Delay converts a recoverable fraud into a loss.
- Existing tooling is split: transcription tools do not prioritise, and "voice lie detector"
  products overclaim what acoustics can prove.
- Distressed callers — especially elderly people under "digital arrest" coercion — do not
  self-identify as critical; they just sound like one more call.

**Design goal:** give the officer a fast, explainable, auditable *support-priority* signal, never
an automated judgement about truth or guilt.

**Non-goals (state these out loud):** we do not detect lies, deception, intent, or guilt; we do
not make enforcement, eligibility, or credibility decisions; we do not replace the officer.

---

## 3. Users and workflow

| Actor | Need | What the product gives |
|---|---|---|
| Helpline officer | Which call first? | Urgency-ranked queue with scam pattern + SLA |
| Investigating officer | What was actually said? | Synchronised transcript, PII masking, keyword triggers |
| Supervisor | Why was this escalated? | Explainable reasons, priority band, officer confirmation note |
| Evidence custodian | Is the recording intact? | SHA-256 fingerprint + case brief export |

Workflow: **intake → rank → listen → read → verify → note → export**. Every operational action
opens a confirmation modal that states a human must verify it.

---

## 4. What we actually built

**Frontend — React 19 + Vite 8 command console (the product)**
- Five workspaces: Overview, Triage Queue, Live Monitor, Intelligence, Case Files.
- Working navigation from sidebar and header quick-nav; active view/heading/tab stay in sync.
- Live Monitor: audio transport (play/pause/seek/restart), canvas waveform, urgency gauge,
  5-axis emotion radar, emotion timeline, MFCC heatmap, transcript with active-segment sync.
- Live IST clock, microphone capture with browser speech-to-text, audio import.
- Guided demo (`?` or the header button) that walks a reviewer through five steps.
- Keyboard shortcuts (`Space`, `1`–`5`, `?`, `Esc`), settings drawer, PII toggle, error boundary.
- Resilience: buffering state, `Reload audio`, and an automatic synthetic-voice fallback if a
  source cannot be decoded.

**Analysis engine — Python 3 (`audio_engine.py`, used by the optional Streamlit console)**
- Loads WAV, resamples to 16 kHz, frames at 500 ms with 250 ms hop.
- Extracts F0 (pyin/yin), jitter, shimmer, RMS, ZCR, spectral centroid/bandwidth/rolloff,
  MFCC (13), onset-based speech rate, tempo.
- Scores five emotion indicators with a transparent sigmoid heuristic.
- Computes urgency = 0.7 × emotion composite + 0.3 × keyword score; maps to four priority bands.
- Generates human-readable XAI reasons, PII redaction, SHA-256 integrity verification.

**Case data — six English demo calls**
- Clear neural English voices so a judge can understand the caller without reading first.
- Two suspected-fraudster calls (RBI impersonation, mule recruitment) and four victim/informant
  calls, each with channel, language, scam pattern, vulnerability flags, jurisdiction, SLA,
  and a call reference.

**Deployment & quality**
- Live static site on Render, built from GitHub `main`.
- 64 jsdom interaction assertions + 9 real-browser playback assertions.

---

## 5. Architecture and data flow

```
Caller audio (WAV / mic / upload)
        │
        ▼
┌───────────────────────────────┐
│ Browser                        │
│  HTMLAudioElement + Web Audio  │──► AnalyserNode ──► canvas waveform
│  MediaRecorder / SpeechRecog.  │──► live transcript (mic path)
│  React state: playhead, PII,   │
│  selected case, queue, notes   │
└───────────────┬───────────────┘
                │ (offline / optional)
                ▼
┌───────────────────────────────┐
│ Python DSP engine              │
│  frame → features → heuristic  │
│  emotion scores → urgency      │
│  → XAI reasons, SHA-256        │
└───────────────────────────────┘
```

**Important honesty point:** in the React console, the radar/timeline/MFCC motion is driven by
a per-case **demo profile** and the audio clock, not by decoding the WAV in the browser. The
Python engine is the real feature extractor and scores the WAVs, but its output is not yet piped
into the React telemetry. Say this plainly if asked — see §6 and §10.

---

## 6. Models and algorithms — what is learned, what is not

| Component | What it really is | Learned? | Used for |
|---|---|---|---|
| Demo voices | Microsoft Edge neural TTS (`en-IN-NeerjaExpressive`, `en-IN-Neerja`, `en-IN-Prabhat`, `en-GB-Ryan`) | Yes (pretrained neural TTS) | Generating the six demo calls only |
| Pitch / loudness / spectrum | librosa DSP: pyin/yin, RMS, ZCR, spectral centroid/bandwidth/rolloff, MFCC, onset detection | No — signal processing | Extracting measurable acoustic features |
| Emotion indicator scoring | Hand-written sigmoid thresholds and expert weights (`EmotionScorer`) | **No — rule-based heuristic** | Producing distress/fear/anger/nervousness/calm 0–100 |
| Urgency score | Weighted composite (0.7 emotion + 0.3 keywords) + priority bands | **No — rule-based** | Triage ordering |
| Console telemetry | Deterministic profile curves per case (`PROFILE_LIBRARY`, `makeTelemetry`) + playhead | **No — simulated demo data** | Animating radar/timeline for the demo |
| Waveform | Web Audio `AnalyserNode.getByteTimeDomainData` | No — DSP | Live waveform |
| PII masking | Regular expressions | No | Display-level redaction |
| Integrity | SHA-256 | No — cryptographic hash | Evidence fingerprint |

**So, in one sentence for judges:** *we did not train an emotion classifier; we built a
transparent, explainable heuristic on top of real acoustic features, and we deliberately label
the console's animated telemetry as demo profiles until the engine is calibrated and wired
through.*

Why we chose this: with no labelled Indian-English cybercrime call corpus, a trained "emotion
AI" would be unvalidated and easy to overclaim. A transparent heuristic plus a strong workflow
is honest, auditable, and demoable — and it gives us the labels we need to train the next
version.

---

## 7. Data provenance

- Six scripts written by the team for this prototype; no real call recordings, no real PII.
- Voices synthesised with Edge TTS; converted with ffmpeg to 16 kHz mono 16-bit WAV.
- Durations 22.8–39.9 s; 82–86% of half-second windows contain speech energy; peak 0.57–0.91.
- `call_metadata.json` carries caller type, role, crime type, transcript, keywords, channel,
  language, scam pattern, vulnerability flags, jurisdiction, SLA, reference, duration.
- Every case is regenerable with `python generate_voice_calls.py` (requires network).

---

## 8. Responsible AI guardrails

- **Assistive only:** indicators prioritise *support*, not suspicion. No deception/intent/guilt
  inference anywhere in the product.
- **Human-in-the-loop:** escalation, bank-freeze, and watchlist actions open a confirmation
  modal and write an in-app note only.
- **Local-first:** files are processed in the browser; the static host serves assets, it does
  not receive audio.
- **Display-level redaction:** PII masking changes the UI only; audio is untouched.
- **Documented limits on screen:** the dashboard states that emotion estimates are noisy and
  culturally dependent.
- **Evidence integrity:** SHA-256 fingerprint per asset, exportable with the case brief.

---

## 9. Evidence we can show

**Reliability (measured)**
- 64/64 jsdom interaction assertions (navigation, queue, playback, transcript, tour, shortcuts).
- 9/9 real-browser playback assertions in Edge (page never blanks, clock advances, waveform paints,
  zero console errors).
- Production build ≈ 0.3–0.6 s; static site responds 200 with all six WAVs.

**Engine output on the six calls (real feature extraction, urgency heuristic v0)**

| Case | F0 (Hz) | Jitter | RMS | Centroid | Engine urgency |
|---|---|---|---|---|---|
| 101 UPI / digital arrest | 282.5 | 5.75% | 0.080 | 1748 | 41.0 MODERATE |
| 102 Ransomware tip | 128.6 | 5.84% | 0.109 | 1600 | 21.6 LOW |
| 103 SIM swap | 131.3 | 6.25% | 0.139 | 1354 | 20.1 LOW |
| 104 Vishing suspect | 124.7 | 6.57% | 0.068 | 1650 | 17.2 LOW |
| 105 Elderly digital arrest | 255.0 | 5.19% | 0.071 | 1841 | 27.2 LOW |
| 106 Mule recruiter | 135.6 | 6.73% | 0.126 | 1303 | 17.2 LOW |

**Read this honestly:** the engine correctly puts 101 first and separates female-pitch calls
(101, 105) from male-pitch calls, but the thresholds are tuned for older synthetic tones, not
neural TTS speech, and keyword weighting is too weak. That is why the console's visual urgency
(profile-driven, e.g. 96 for 101) does **not** match the engine's 41. Present the engine table as
"feature pipeline working, calibration pending", never as accuracy.

---

## 10. Limitations (say them before the judges do)

1. No trained SER model; heuristic thresholds are not validated against labelled data.
2. Console telemetry is profile-driven, not derived live from the audio file.
3. Engine urgency is under-calibrated for synthetic speech and keyword weighting is weak.
4. Six demo calls only; no accent, age, gender, or channel diversity study.
5. Browser speech-to-text depends on the browser (Edge/Chrome), not on our model.
6. No persistence, authentication, or multi-user audit store yet — it is a prototype.

---

## 11. Roadmap to a defensible model

**Phase 1 — data.** Collect consented, de-identified calls with officer labels (priority,
disposition) under an ethics protocol; augment with public corpora (RAVDESS, CREMA-D, IEMOCAP)
for pretraining only, and Indian-English call data for domain adaptation.

**Phase 2 — model.** Fine-tune a speech encoder (wav2vec 2.0 / HuBERT / Whisper encoder) for
5-class stress indicators, plus a text encoder for scam-script similarity. Fuse with calibrated
weights; keep an explainability head (attention/feature attribution).

**Phase 3 — calibration & validation.** Speaker-normalised features, temperature scaling,
expected calibration error, and a held-out officer study measuring triage time and agreement.
Report UAR/F1 per class and ECE — not a single "accuracy" number.

**Phase 4 — productisation.** Stream windowed inference into the console (replace profile
telemetry), audit log, role-based access, retention policy aligned to India's DPDP Act, and a
model card published with the demo.

**What we would need:** labelled calls, ethics approval, and an officer-in-the-loop evaluation.

---

## 12. Judge Q&A — answer these directly

**Q: Is this a real AI model?**
A: Not yet a trained emotion model. It is a real DSP feature pipeline plus a transparent
rule-based scorer, with a genuinely working triage console around it. The only pretrained
neural model in the repo generated the demo voices. We label the simulated parts explicitly.

**Q: Why didn't you just use a pretrained emotion model?**
A: Domain shift and validity. Models trained on acted English corpora do not transfer to Indian
call-centre speech, and we had no labelled cybercrime calls to validate against. Shipping an
unvalidated classifier into a police workflow is worse than shipping an honest heuristic.

**Q: What is your accuracy?**
A: We make no emotion-accuracy claim. What we measured is system reliability: 64 interaction
assertions and 9 real-browser playback checks pass, and the engine extracts stable features from
all six calls.

**Q: Why does the console show urgency 96 while the engine says 41?**
A: The console's telemetry is a curated demo profile; the engine is the analysis path. They are
not wired together yet — that wiring plus calibration is the next milestone. We chose to show a
complete workflow rather than fake a model.

**Q: Isn't voice emotion analysis pseudoscience?**
A: Stress correlates with pitch/jitter/energy, but emotion inference is noisy and culturally
dependent. That is why the product never says "deceptive" or "guilty", shows the reasons, and
requires an officer to verify.

**Q: Privacy?**
A: Audio is processed locally; the static host only serves the app. PII is masked in the UI, and
integrity is hashed. Persistence/retention policy is on the roadmap.

**Q: What happens with a real call?**
A: Mic capture records locally, browser speech-to-text streams a transcript, and the same
queue/evidence workflow applies. The officer still verifies everything.

**Q: What is genuinely novel?**
A: Not the classifier — the workflow. Scam-pattern context, SLA, vulnerability flags, evidence
hashing, explainability, and human-confirmation gates in one console, designed for cybercrime
triage rather than generic emotion analytics.

**Q: Can it scale?**
A: The frontend is static and cheap. Analysis is per-call CPU today; streaming windowed inference
is the scaling path. No GPU is required for the current demo.

**Q: What if the demo fails on stage?**
A: Guided demo resets state, the app has an error boundary, audio falls back to a locally
generated synthetic sample if decoding fails, and the deployed site is independent of the laptop.

**Q: Legal/ethical risk?**
A: We restrict the product to prioritisation and support. No enforcement, eligibility, or
credibility decisions; no automated external action; limits displayed on screen.

**Q: Team contribution?**
A: [FILL: who did UI, DSP, data/voices, testing, deployment.] Keep it specific and honest.

---

## 13. Five-minute demo script (click by click)

1. **Overview (30 s).** "Six live cases, ranked. Note the pattern and SLA chips — this is context,
   not just a score."
2. **Guided demo (2 min).** Click `▶ Guided demo`. Step 1: press **Play call** → 101 plays (31 s).
   Point at the waveform, radar, timeline, transcript highlighting. "All four views share one
   clock."
3. **Transcript/PII (30 s).** Toggle **PII masked → visible**. "Display-level redaction; audio
   untouched."
4. **Queue (30 s).** Switch to Triage Queue. "105 — elderly, lives alone, ongoing coercion, 15-minute
   SLA — sits second. That is the point: the vulnerable caller does not have to sound the loudest."
5. **Case Files (30 s).** Open Case Files, show the SHA-256 fingerprint, export the brief.
6. **Honesty close (30 s).** "The console's animated telemetry is a demo profile. The Python engine
   extracts real features from these WAVs and scores them with a transparent heuristic — here is
   the table. Next step is calibration and wiring, not a bigger claim."

Fallback if audio is blocked: use **Mic capture** or press play twice; the app shows a buffering
state and falls back to a synthetic sample rather than dying.

---

## 14. Twelve-slide outline

1. Title + one-liner
2. Problem: queue vs golden hour
3. Why existing tools fail
4. Insight: prioritise support, not guilt
5. Product: five workspaces
6. Demo: audio + synchronised views
7. Demo: transcript, PII, queue context
8. How it works: audio → features → heuristic → urgency
9. Models: what is learned vs rule-based (honesty slide)
10. Guardrails + evidence integrity
11. Evidence: tests, live deployment, engine table
12. Limits + roadmap + ask

---

## 15. Fact sheet

- **Live:** https://cyberser-command-center.onrender.com
- **Repo:** https://github.com/opzain/Codex_SyedZainuddin
- **Stack:** React 19.3, Vite 8, Node 22.12; Python 3.14, librosa 1.0, NumPy 2.5, SoundFile 0.14
- **Voice generation:** edge-tts 7.3.1 + ffmpeg 9.0.2 (imageio-ffmpeg)
- **Tests:** 64 jsdom assertions, 9 real-browser playback assertions (playwright-core + Edge)
- **Deploy:** Render static site `cyberser-command-center`, built from `main`
- **Demo audio:** 6 WAVs, 22.8–39.9 s, 16 kHz mono, regenerable with `generate_voice_calls.py`

---

## 16. What to say if you only get 2 minutes

"Cybercrime helplines cannot rank distress fast enough, and the first hour decides whether money
is recoverable. We built a working triage console: play the call, see stress indicators and the
transcript on one clock, rank six cases by urgency with scam context and SLAs, and export a
hash-verified brief — with every escalation left to a human. The analysis is a transparent
heuristic on real acoustic features, not a trained emotion model, and we say so. The demo is live
at this URL; the next step is calibration on labelled Indian-English calls."
