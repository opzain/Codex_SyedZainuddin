"""Generate intelligible English demo calls for the CyberSER command center.

Uses Microsoft Edge neural TTS (edge-tts) for natural-sounding speech and
ffmpeg (via imageio-ffmpeg) to produce 16 kHz mono PCM WAV files that match
the audio pipeline used by the app and the Python DSP engine.

Run:  .venv\\Scripts\\python.exe generate_voice_calls.py

Requires network access for the TTS service. The generated voices are
synthetic and contain no real caller data.
"""
from __future__ import annotations

import asyncio
import json
import subprocess
import tempfile
from pathlib import Path

import edge_tts
import imageio_ffmpeg
import soundfile as sf

ROOT = Path(__file__).resolve().parent
SAMPLE_DIR = ROOT / "sample_calls"
PUBLIC_DIR = ROOT / "public" / "sample_calls"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

SCENARIOS = [
    {
        "id": "101",
        "filename": "call_101_victim_upi_fraud.wav",
        "voice": "en-IN-NeerjaExpressiveNeural",
        "rate": "+8%",
        "pitch": "+3Hz",
        "volume": "+6%",
        "text": (
            "Hello? Please, you have to help me. Someone has taken money from my account. "
            "I got a call this morning from a man who said he was from the bank. "
            "He told me my account was under digital arrest. He said I would be jailed if I did not cooperate. "
            "He asked me to share the one time password. I shared it. "
            "Two minutes later, two lakh forty five thousand rupees was gone. "
            "Please freeze my account. I am begging you."
        ),
        "caller_id": "+91-XXXXXX4821",
        "caller_type": "Distressed Victim",
        "role": "victim",
        "crime_type": "UPI Fraud - Digital Arrest Coercion",
        "priority_tag": "CRITICAL - GOLDEN HOUR",
        "keywords_detected": ["OTP shared", "digital arrest", "UPI unauthorized debit", "account freeze"],
        "channel": "1930 helpline",
        "language": "English (Indian)",
        "scam_pattern": "Digital arrest",
        "vulnerability": ["Coercion", "Active financial loss"],
        "jurisdiction": "Mumbai Cyber Cell",
        "sla_minutes": 15,
        "call_reference": "MH-1930-10482",
        "timestamp": "2026-11-06T08:47:12+05:30",
    },
    {
        "id": "102",
        "filename": "call_102_informant_ransomware_tip.wav",
        "voice": "en-IN-PrabhatNeural",
        "rate": "-6%",
        "pitch": "-2Hz",
        "volume": "-8%",
        "text": (
            "Listen, I cannot talk for long. I work as a contract system administrator. "
            "A group is planning a ransomware attack on the municipal server. "
            "The malware is already inside the backup network. They are asking for fifty lakh rupees in crypto. "
            "You need to check the backup systems tonight. "
            "I will send proof to the secure email address on your website. Please do not call this number again."
        ),
        "caller_id": "+91-XXXXXX7293",
        "caller_type": "Anonymous Informant",
        "role": "informant",
        "crime_type": "Ransomware Attack Intelligence",
        "priority_tag": "HIGH URGENCY",
        "keywords_detected": ["ransomware", "municipal server", "backup network", "crypto demand"],
        "channel": "Anonymous tip line",
        "language": "English (Indian)",
        "scam_pattern": "Ransomware extortion",
        "vulnerability": ["Critical infrastructure", "Time-bound threat"],
        "jurisdiction": "Pune Cyber Cell",
        "sla_minutes": 30,
        "call_reference": "MH-TIP-22190",
        "timestamp": "2026-11-06T08:52:35+05:30",
    },
    {
        "id": "103",
        "filename": "call_103_angry_account_compromise.wav",
        "voice": "en-IN-PrabhatNeural",
        "rate": "+6%",
        "pitch": "+1Hz",
        "volume": "+12%",
        "text": (
            "What the hell is going on? My entire savings account has been wiped out. "
            "I have been calling your helpline for two hours. "
            "Someone cloned my SIM card and bypassed the authentication. "
            "They transferred nine lakh rupees in four transactions. "
            "I want the cyber cell head on the phone right now. "
            "And I want a written complaint number before I hang up."
        ),
        "caller_id": "+91-XXXXXX1056",
        "caller_type": "Angry Victim",
        "role": "victim",
        "crime_type": "Bank Account Compromise - SIM Swap",
        "priority_tag": "HIGH URGENCY",
        "keywords_detected": ["SIM clone", "authentication bypass", "savings wiped", "written complaint"],
        "channel": "Transferred from branch",
        "language": "English (Indian)",
        "scam_pattern": "SIM swap takeover",
        "vulnerability": ["Total savings lost", "Escalation risk"],
        "jurisdiction": "Delhi Cyber Cell",
        "sla_minutes": 30,
        "call_reference": "DL-1930-33917",
        "timestamp": "2026-11-06T09:01:48+05:30",
    },
    {
        "id": "104",
        "filename": "call_104_suspected_vishing_caller.wav",
        "voice": "en-GB-RyanNeural",
        "rate": "-4%",
        "pitch": "-4Hz",
        "volume": "+0%",
        "text": (
            "Good morning, officer. I am calling from the Reserve Bank compliance department. "
            "We have detected suspicious activity on accounts in your jurisdiction. "
            "I need you to verify the nodal officer credentials and share the secure access token for the banking portal. "
            "This is a time sensitive audit. Please do not disconnect the call."
        ),
        "caller_id": "+91-XXXXXX5580",
        "caller_type": "Suspected Fraudster / Vishing",
        "role": "suspect",
        "crime_type": "Vishing - RBI Impersonation",
        "priority_tag": "MODERATE - SUSPECT CALL",
        "keywords_detected": ["Reserve Bank impersonation", "credential request", "access token", "social engineering"],
        "channel": "Recorded by complainant",
        "language": "English (British accent)",
        "scam_pattern": "Authority impersonation",
        "vulnerability": ["Credential phishing", "Insider target"],
        "jurisdiction": "Bengaluru Cyber Cell",
        "sla_minutes": 60,
        "call_reference": "KA-SUS-88214",
        "timestamp": "2026-11-06T09:15:22+05:30",
    },
    {
        "id": "105",
        "filename": "call_105_elderly_digital_arrest.wav",
        "voice": "en-IN-NeerjaNeural",
        "rate": "-10%",
        "pitch": "-6Hz",
        "volume": "-2%",
        "text": (
            "Officer, I am seventy two years old and I live alone. "
            "This afternoon I received a video call. The man was wearing a police uniform. "
            "He said my Aadhaar card was linked to a money laundering case, and that a warrant had been issued. "
            "He said I was under digital arrest and could not tell anyone. "
            "He made me transfer one lakh eighty thousand rupees as a verification deposit. "
            "Then he demanded five lakh more. I am scared. Please tell me what to do."
        ),
        "caller_id": "+91-XXXXXX9074",
        "caller_type": "Elderly Victim",
        "role": "victim",
        "crime_type": "Digital Arrest Scam - Elderly Victim",
        "priority_tag": "CRITICAL - VULNERABLE ADULT",
        "keywords_detected": ["digital arrest", "police impersonation", "Aadhaar linked", "verification deposit"],
        "channel": "1930 helpline",
        "language": "English (Indian)",
        "scam_pattern": "Digital arrest",
        "vulnerability": ["Elderly", "Lives alone", "Ongoing coercion"],
        "jurisdiction": "Kolkata Cyber Cell",
        "sla_minutes": 15,
        "call_reference": "WB-1930-77103",
        "timestamp": "2026-11-06T09:22:07+05:30",
    },
    {
        "id": "106",
        "filename": "call_106_mule_account_recruiter.wav",
        "voice": "en-IN-PrabhatNeural",
        "rate": "+2%",
        "pitch": "-5Hz",
        "volume": "+2%",
        "text": (
            "Hey, listen. I have a simple job for you. You do not have to do anything illegal. "
            "Just open a current account and give me the debit card and the SIM card. "
            "I will pay you five thousand rupees every month. "
            "The money that comes in is from a gaming company. Nothing will happen to you. "
            "Nobody checks these accounts. Are you interested or not?"
        ),
        "caller_id": "+91-XXXXXX6312",
        "caller_type": "Suspected Mule Recruiter",
        "role": "suspect",
        "crime_type": "Mule Account Recruitment - Suspect Call",
        "priority_tag": "HIGH - SUSPECT EVIDENCE",
        "keywords_detected": ["mule account", "debit card request", "SIM handover", "monthly payout"],
        "channel": "Uploaded by complainant",
        "language": "English (Indian)",
        "scam_pattern": "Money mule recruitment",
        "vulnerability": ["Financial crime enabler", "Student target"],
        "jurisdiction": "Hyderabad Cyber Cell",
        "sla_minutes": 60,
        "call_reference": "TS-SUS-45019",
        "timestamp": "2026-11-06T09:31:55+05:30",
    },
]


async def synth(scenario: dict, destination: Path) -> None:
    communicate = edge_tts.Communicate(
        scenario["text"],
        scenario["voice"],
        rate=scenario["rate"],
        pitch=scenario["pitch"],
        volume=scenario["volume"],
    )
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as handle:
        temp_mp3 = Path(handle.name)
    try:
        await communicate.save(str(temp_mp3))
        subprocess.run(
            [
                FFMPEG, "-y", "-loglevel", "error",
                "-i", str(temp_mp3),
                "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
                str(destination),
            ],
            check=True,
        )
    finally:
        temp_mp3.unlink(missing_ok=True)


def build_metadata(durations: dict[str, float]) -> dict:
    metadata = {}
    for scenario in SCENARIOS:
        metadata[scenario["filename"]] = {
            "caller_id": scenario["caller_id"],
            "caller_type": scenario["caller_type"],
            "role": scenario["role"],
            "crime_type": scenario["crime_type"],
            "priority_tag": scenario["priority_tag"],
            "transcript": scenario["text"],
            "keywords_detected": scenario["keywords_detected"],
            "timestamp": scenario["timestamp"],
            "duration_sec": round(durations[scenario["filename"]], 2),
            "channel": scenario["channel"],
            "language": scenario["language"],
            "scam_pattern": scenario["scam_pattern"],
            "vulnerability": scenario["vulnerability"],
            "jurisdiction": scenario["jurisdiction"],
            "sla_minutes": scenario["sla_minutes"],
            "call_reference": scenario["call_reference"],
        }
    return metadata


async def main() -> None:
    SAMPLE_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    durations: dict[str, float] = {}

    for scenario in SCENARIOS:
        target = SAMPLE_DIR / scenario["filename"]
        print(f"voicing CALL-{scenario['id']} with {scenario['voice']} ...", flush=True)
        await synth(scenario, target)
        info = sf.info(str(target))
        durations[scenario["filename"]] = info.duration

        # Mirror into the Vite public directory so the browser can fetch it.
        (PUBLIC_DIR / scenario["filename"]).write_bytes(target.read_bytes())

        peak = 0.0
        data, _ = sf.read(str(target), dtype="float32")
        peak = float(abs(data).max()) if len(data) else 0.0
        print(f"  {scenario['filename']}: {info.duration:.1f}s, peak {peak:.2f}", flush=True)

    metadata = build_metadata(durations)
    payload = json.dumps(metadata, indent=2, ensure_ascii=False)
    for directory in (SAMPLE_DIR, PUBLIC_DIR):
        (directory / "call_metadata.json").write_text(payload + "\n", encoding="utf-8")

    print("\nDurations:")
    for scenario in SCENARIOS:
        print(f"  {scenario['id']}: {durations[scenario['filename']]:.2f}s")
    print(f"\nWrote {len(SCENARIOS)} calls and call_metadata.json to both directories.")


if __name__ == "__main__":
    asyncio.run(main())
