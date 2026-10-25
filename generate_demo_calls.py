#!/usr/bin/env python3
"""
generate_demo_calls.py
======================
Programmatically synthesizes 4 realistic .wav cybercrime call audio profiles
with distinct acoustic signatures using only numpy, scipy, and soundfile.

Each call simulates a different emotional/behavioral state relevant to
cybercrime call center triage:
  - Call 101: Distressed victim (UPI Fraud) — severe distress & fear
  - Call 102: Nervous informant (Ransomware Tip) — high nervousness & urgency
  - Call 103: Angry caller (Account Compromise) — high anger & agitation
  - Call 104: Suspected vishing caller — controlled/deceptive with micro-nervousness

Usage:
    python generate_demo_calls.py

The script creates a `sample_calls/` directory (relative to the script location)
containing 4 WAV files and a `call_metadata.json` manifest.
"""

import json
import os
import sys
from pathlib import Path

import numpy as np
from scipy.signal import butter, lfilter, sosfilt, sosfreqz
import soundfile as sf


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
SAMPLE_RATE = 16000
BIT_DEPTH_SUBTYPE = "PCM_16"


# ---------------------------------------------------------------------------
# DSP Utility Functions
# ---------------------------------------------------------------------------

def generate_glottal_pulse_train(duration_sec: float, f0_contour: np.ndarray,
                                  sr: int = SAMPLE_RATE) -> np.ndarray:
    """
    Generate a glottal-pulse-like excitation signal whose instantaneous
    fundamental frequency follows *f0_contour* (one value per sample).

    The pulse shape approximates a Liljencrants–Fant (LF) glottal waveform
    using a half-cosine open phase + exponential return phase within each
    pitch period.
    """
    n_samples = int(duration_sec * sr)
    if len(f0_contour) < n_samples:
        f0_contour = np.interp(
            np.linspace(0, 1, n_samples),
            np.linspace(0, 1, len(f0_contour)),
            f0_contour,
        )
    f0_contour = f0_contour[:n_samples]

    signal = np.zeros(n_samples, dtype=np.float64)
    phase = 0.0
    for i in range(n_samples):
        f0 = max(f0_contour[i], 50.0)
        period = sr / f0
        # Normalize phase within [0, 1) of current period
        t_norm = phase / period
        # LF-like pulse: open phase (0–0.6) half-cosine, return phase (0.6–1.0) exponential
        if t_norm < 0.6:
            signal[i] = 0.5 * (1.0 - np.cos(np.pi * t_norm / 0.6))
        else:
            decay = (t_norm - 0.6) / 0.4
            signal[i] = np.exp(-5.0 * decay) * 0.5
        phase += 1.0
        if phase >= period:
            phase -= period

    # Remove DC
    signal -= np.mean(signal)
    return signal


def apply_jitter(f0_contour: np.ndarray, jitter_pct: float) -> np.ndarray:
    """Add cycle-to-cycle pitch perturbation (jitter)."""
    noise = np.random.randn(len(f0_contour))
    # Smooth the noise slightly so it acts per-cycle rather than per-sample
    kernel = np.ones(80) / 80
    noise = np.convolve(noise, kernel, mode="same")
    return f0_contour * (1.0 + jitter_pct / 100.0 * noise)


def apply_shimmer(signal: np.ndarray, shimmer_pct: float) -> np.ndarray:
    """Add micro-amplitude fluctuations (shimmer)."""
    noise = np.random.randn(len(signal))
    kernel = np.ones(120) / 120
    noise = np.convolve(noise, kernel, mode="same")
    modulator = 1.0 + shimmer_pct / 100.0 * noise
    return signal * modulator


def apply_vibrato(f0_contour: np.ndarray, rate_hz: float = 5.5,
                  depth_hz: float = 4.0, sr: int = SAMPLE_RATE) -> np.ndarray:
    """Apply vibrato (periodic pitch modulation)."""
    t = np.arange(len(f0_contour)) / sr
    vibrato = depth_hz * np.sin(2.0 * np.pi * rate_hz * t)
    return f0_contour + vibrato


def apply_tremor(signal: np.ndarray, rate_hz: float = 5.0,
                 depth: float = 0.15, sr: int = SAMPLE_RATE) -> np.ndarray:
    """Apply amplitude tremor (low-frequency amplitude modulation)."""
    t = np.arange(len(signal)) / sr
    envelope = 1.0 - depth * (0.5 + 0.5 * np.sin(2.0 * np.pi * rate_hz * t))
    return signal * envelope


def bandpass_filter(signal: np.ndarray, low: float, high: float,
                    sr: int = SAMPLE_RATE, order: int = 4) -> np.ndarray:
    """Butterworth bandpass filter."""
    nyq = sr / 2.0
    low_n = max(low / nyq, 0.001)
    high_n = min(high / nyq, 0.999)
    if low_n >= high_n:
        return signal
    sos = butter(order, [low_n, high_n], btype="band", output="sos")
    return sosfilt(sos, signal)


def formant_filter(signal: np.ndarray, formants: list,
                   sr: int = SAMPLE_RATE) -> np.ndarray:
    """
    Apply formant resonances.  *formants* is a list of (center_hz, bandwidth_hz)
    tuples.  Each formant is implemented as a narrow bandpass and the results
    are summed.
    """
    out = np.zeros_like(signal)
    for center, bw in formants:
        low = max(center - bw / 2, 30)
        high = min(center + bw / 2, sr / 2 - 10)
        filtered = bandpass_filter(signal, low, high, sr=sr, order=2)
        out += filtered
    # Normalize
    peak = np.max(np.abs(out))
    if peak > 0:
        out /= peak
    return out


def generate_pink_noise(n_samples: int) -> np.ndarray:
    """Generate approximate pink (1/f) noise using the Voss–McCartney method."""
    n_rows = 16
    n_cols = n_samples
    array = np.random.randn(n_rows, n_cols)
    # Progressive halving of update rate
    for i in range(1, n_rows):
        step = 2 ** i
        hold = array[i, 0]
        for j in range(n_cols):
            if j % step == 0:
                hold = np.random.randn()
            array[i, j] = hold
    pink = np.sum(array, axis=0)
    pink /= np.max(np.abs(pink)) + 1e-12
    return pink


def generate_white_noise(n_samples: int) -> np.ndarray:
    """Generate white noise normalized to [-1, 1]."""
    noise = np.random.randn(n_samples)
    noise /= np.max(np.abs(noise)) + 1e-12
    return noise


def generate_breathing_sound(duration_sec: float, sr: int = SAMPLE_RATE) -> np.ndarray:
    """
    Generate a short breath-like noise burst (inhale/exhale simulation).
    """
    n = int(duration_sec * sr)
    noise = np.random.randn(n)
    # Shape it with an envelope (fade in, sustain, fade out)
    env = np.ones(n)
    fade_len = int(0.15 * sr)
    if fade_len > 0 and 2 * fade_len < n:
        env[:fade_len] = np.linspace(0, 1, fade_len)
        env[-fade_len:] = np.linspace(1, 0, fade_len)
    noise *= env
    # Bandpass to breath-like range
    noise = bandpass_filter(noise, 400, 3500, sr=sr, order=2)
    noise /= np.max(np.abs(noise)) + 1e-12
    return noise * 0.08  # low amplitude


def generate_fricative_burst(duration_sec: float, sr: int = SAMPLE_RATE) -> np.ndarray:
    """Generate a fricative-like noise segment (consonant simulation)."""
    n = int(duration_sec * sr)
    noise = np.random.randn(n)
    env = np.ones(n)
    attack = int(0.01 * sr)
    release = int(0.02 * sr)
    if attack > 0 and attack < n:
        env[:attack] = np.linspace(0, 1, attack)
    if release > 0 and release < n:
        env[-release:] = np.linspace(1, 0, release)
    noise *= env
    # High-pass for fricative character
    noise = bandpass_filter(noise, 2500, 7500, sr=sr, order=3)
    peak = np.max(np.abs(noise))
    if peak > 0:
        noise /= peak
    return noise * 0.3


def create_syllable_envelope(n_samples: int, attack_frac: float = 0.15,
                              decay_frac: float = 0.25) -> np.ndarray:
    """Create an amplitude envelope for a single syllable."""
    env = np.zeros(n_samples)
    attack = int(n_samples * attack_frac)
    decay = int(n_samples * decay_frac)
    sustain = n_samples - attack - decay
    if attack > 0:
        env[:attack] = np.linspace(0, 1, attack)
    if sustain > 0:
        env[attack:attack + sustain] = 1.0
    if decay > 0:
        env[attack + sustain:] = np.linspace(1, 0, max(decay, n_samples - attack - sustain))
    # Ensure correct length
    env = env[:n_samples]
    if len(env) < n_samples:
        env = np.concatenate([env, np.zeros(n_samples - len(env))])
    return env


def create_speech_rhythm(total_samples: int, syllable_durations_ms: list,
                          pause_durations_ms: list,
                          sr: int = SAMPLE_RATE) -> np.ndarray:
    """
    Build a composite amplitude envelope from alternating syllable and pause
    segments, creating natural speech rhythm.
    """
    envelope = np.zeros(total_samples)
    pos = 0
    for i, syl_ms in enumerate(syllable_durations_ms):
        syl_n = int(syl_ms / 1000.0 * sr)
        if pos + syl_n > total_samples:
            syl_n = total_samples - pos
        if syl_n <= 0:
            break
        syl_env = create_syllable_envelope(syl_n)
        envelope[pos:pos + syl_n] = syl_env
        pos += syl_n
        # Add pause
        if i < len(pause_durations_ms):
            pause_n = int(pause_durations_ms[i] / 1000.0 * sr)
            pos += pause_n
        if pos >= total_samples:
            break
    return envelope


def normalize_audio(signal: np.ndarray, target_peak: float = 0.9) -> np.ndarray:
    """Normalize to a target peak amplitude."""
    peak = np.max(np.abs(signal))
    if peak > 0:
        signal = signal * (target_peak / peak)
    return signal


def mix_signals(*signals_and_gains: tuple) -> np.ndarray:
    """
    Mix multiple signals.  Each argument is (signal, gain).
    All signals are zero-padded to the length of the longest.
    """
    max_len = max(len(s) for s, _ in signals_and_gains)
    mixed = np.zeros(max_len)
    for sig, gain in signals_and_gains:
        padded = np.zeros(max_len)
        padded[:len(sig)] = sig
        mixed += padded * gain
    return mixed


def add_telephone_effect(signal: np.ndarray, sr: int = SAMPLE_RATE) -> np.ndarray:
    """Simulate telephone bandpass (300–3400 Hz)."""
    return bandpass_filter(signal, 300, 3400, sr=sr, order=5)


# ---------------------------------------------------------------------------
# Voiced Speech Synthesis Core
# ---------------------------------------------------------------------------

def synthesize_voiced_speech(
    duration_sec: float,
    f0_mean: float,
    f0_variance: float,
    jitter_pct: float,
    shimmer_pct: float,
    vibrato_rate: float,
    vibrato_depth: float,
    tremor_rate: float,
    tremor_depth: float,
    formants: list,
    syllable_durations_ms: list,
    pause_durations_ms: list,
    pitch_contour_type: str = "neutral",
    breathiness: float = 0.0,
    sr: int = SAMPLE_RATE,
) -> np.ndarray:
    """
    Synthesize a speech-like voiced signal with the given acoustic parameters.

    Parameters
    ----------
    duration_sec : float
        Total duration in seconds.
    f0_mean : float
        Mean fundamental frequency in Hz.
    f0_variance : float
        Variance (±Hz) around the mean for the pitch contour.
    jitter_pct : float
        Cycle-to-cycle pitch perturbation percentage.
    shimmer_pct : float
        Cycle-to-cycle amplitude perturbation percentage.
    vibrato_rate : float
        Vibrato rate in Hz.
    vibrato_depth : float
        Vibrato depth in Hz.
    tremor_rate : float
        Tremor (amplitude modulation) rate in Hz.
    tremor_depth : float
        Tremor depth (0–1).
    formants : list of (center_hz, bandwidth_hz)
        Formant frequencies and bandwidths.
    syllable_durations_ms : list of float
        Durations of syllable-like voiced segments in milliseconds.
    pause_durations_ms : list of float
        Durations of pauses between syllables in milliseconds.
    pitch_contour_type : str
        One of "neutral", "rising", "falling", "erratic", "controlled".
    breathiness : float
        Amount of breathy noise to mix in (0–1).
    sr : int
        Sample rate.

    Returns
    -------
    np.ndarray
        The synthesized mono audio signal.
    """
    n_samples = int(duration_sec * sr)

    # --- Step 1: Build F0 contour ---
    t = np.linspace(0, duration_sec, n_samples)

    if pitch_contour_type == "rising":
        base_contour = f0_mean + f0_variance * np.linspace(-1, 1, n_samples)
    elif pitch_contour_type == "falling":
        base_contour = f0_mean + f0_variance * np.linspace(1, -1, n_samples)
    elif pitch_contour_type == "erratic":
        # Random walk with smoothing
        rng = np.random.RandomState(42)
        walk = np.cumsum(rng.randn(n_samples) * 0.02)
        walk = walk / (np.max(np.abs(walk)) + 1e-12)
        base_contour = f0_mean + f0_variance * walk
    elif pitch_contour_type == "controlled":
        # Very stable with tiny drift
        base_contour = f0_mean + f0_variance * 0.1 * np.sin(2 * np.pi * 0.3 * t)
    else:  # neutral
        # Gentle intonation curve
        base_contour = f0_mean + f0_variance * 0.5 * np.sin(2 * np.pi * 0.8 * t)

    # --- Step 2: Apply vibrato ---
    f0_contour = apply_vibrato(base_contour, rate_hz=vibrato_rate,
                                depth_hz=vibrato_depth, sr=sr)

    # --- Step 3: Apply jitter ---
    f0_contour = apply_jitter(f0_contour, jitter_pct)

    # Clamp to reasonable range
    f0_contour = np.clip(f0_contour, 50, 600)

    # --- Step 4: Generate glottal pulse train ---
    glottal = generate_glottal_pulse_train(duration_sec, f0_contour, sr=sr)

    # --- Step 5: Apply formant filtering ---
    voiced = formant_filter(glottal, formants, sr=sr)

    # --- Step 6: Apply shimmer ---
    voiced = apply_shimmer(voiced, shimmer_pct)

    # --- Step 7: Apply tremor ---
    voiced = apply_tremor(voiced, rate_hz=tremor_rate, depth=tremor_depth, sr=sr)

    # --- Step 8: Build speech rhythm envelope ---
    rhythm_env = create_speech_rhythm(n_samples, syllable_durations_ms,
                                       pause_durations_ms, sr=sr)
    voiced *= rhythm_env

    # --- Step 9: Add fricative consonant-like segments in pauses ---
    # Insert short fricative bursts at the start of each syllable
    fricative_layer = np.zeros(n_samples)
    pos = 0
    for i, syl_ms in enumerate(syllable_durations_ms):
        fric_dur = min(0.04, syl_ms / 1000.0 * 0.2)  # 20% of syllable or 40ms
        fric_n = int(fric_dur * sr)
        if pos + fric_n <= n_samples:
            fricative_layer[pos:pos + fric_n] = generate_fricative_burst(fric_dur, sr=sr)[:fric_n]
        pos += int(syl_ms / 1000.0 * sr)
        if i < len(pause_durations_ms):
            pos += int(pause_durations_ms[i] / 1000.0 * sr)
        if pos >= n_samples:
            break

    # --- Step 10: Add breathiness ---
    breathy_noise = np.zeros(n_samples)
    if breathiness > 0:
        breathy_noise = generate_white_noise(n_samples)
        breathy_noise = bandpass_filter(breathy_noise, 200, 4000, sr=sr, order=2)
        breathy_noise *= rhythm_env  # Shape breath noise to speech rhythm
        breathy_noise *= breathiness

    # --- Step 11: Mix all components ---
    signal = mix_signals(
        (voiced, 1.0),
        (fricative_layer, 0.25),
        (breathy_noise, 0.3),
    )

    # Trim or pad to exact length
    signal = signal[:n_samples]

    return signal


# ---------------------------------------------------------------------------
# Call Profile Generators
# ---------------------------------------------------------------------------

def generate_call_101(sr: int = SAMPLE_RATE) -> np.ndarray:
    """
    Call 101 — Distressed Victim (UPI Fraud)
    Female voice simulation, ~12 seconds.
    Severe distress & fear (Golden Hour scenario).
    """
    duration = 12.0
    n_samples = int(duration * sr)

    # Female voice formants (higher formant frequencies)
    formants = [
        (800, 120),    # F1 — open vowel
        (1400, 150),   # F2
        (2600, 200),   # F3
        (3500, 250),   # F4
    ]

    # Speech rhythm: erratic with gasps and panicked pauses
    # Fast bursts interspersed with longer pauses (catching breath)
    syllable_durations = [
        180, 150, 200, 120, 160,   # "Hello? Please help me!"
        80,                         # gasp
        220, 180, 200, 250, 180,   # "Someone has taken money"
        100,                        # pause
        200, 150, 180, 220,        # "from my account"
        60,                         # gasp
        200, 180, 250, 200, 150,   # "I received an OTP"
        150, 200, 280, 180,        # "before I could..."
        220, 180, 200, 250,        # "digital arrest"
        180, 200, 250, 200, 150,   # "UPI 2,45,000 gone"
        200, 180, 250, 200,        # "freeze my account"
        180, 200, 250,             # "begging you"
    ]

    pause_durations = [
        40, 30, 50, 30, 60,
        250,  # catching breath
        40, 30, 50, 40, 60,
        300,  # distressed pause
        40, 30, 50, 70,
        200,  # gasp
        40, 30, 40, 50, 60,
        40, 30, 50, 80,
        40, 30, 50, 60,
        40, 30, 40, 50, 80,
        40, 30, 50, 70,
        40, 30,
    ]

    # Synthesize main voice
    voiced = synthesize_voiced_speech(
        duration_sec=duration,
        f0_mean=280.0,
        f0_variance=60.0,
        jitter_pct=6.5,
        shimmer_pct=10.0,
        vibrato_rate=6.0,
        vibrato_depth=8.0,
        tremor_rate=5.5,
        tremor_depth=0.20,
        formants=formants,
        syllable_durations_ms=syllable_durations,
        pause_durations_ms=pause_durations,
        pitch_contour_type="rising",
        breathiness=0.15,
        sr=sr,
    )

    # Add pitch breaks (sobbing simulation) — brief pitch drops
    # Insert at ~3s, ~6s, ~9s
    for break_time in [3.0, 6.2, 9.1]:
        break_start = int(break_time * sr)
        break_dur = int(0.25 * sr)
        if break_start + break_dur < n_samples:
            # Create a brief pitch drop by multiplying with a modulated signal
            t_break = np.arange(break_dur) / sr
            pitch_drop = 0.3 + 0.7 * np.abs(np.sin(2 * np.pi * 3 * t_break))
            voiced[break_start:break_start + break_dur] *= pitch_drop

    # Add breathing sounds at pause locations
    breath_times = [1.8, 4.5, 7.0, 10.0]
    for bt in breath_times:
        breath = generate_breathing_sound(0.35, sr=sr)
        start = int(bt * sr)
        end = min(start + len(breath), n_samples)
        if start < n_samples:
            voiced[start:end] += breath[:end - start]

    # Add background pink noise (indoor environment)
    pink = generate_pink_noise(n_samples) * 0.015

    # Add telephone effect
    signal = voiced + pink
    signal = add_telephone_effect(signal, sr=sr)

    # Add a subtle sob/cry modulation layer
    cry_mod = np.ones(n_samples)
    for sob_time in [2.5, 5.5, 8.5]:
        sob_start = int(sob_time * sr)
        sob_dur = int(0.6 * sr)
        if sob_start + sob_dur < n_samples:
            t_sob = np.arange(sob_dur) / sr
            cry_osc = 0.5 + 0.5 * np.sin(2 * np.pi * 8 * t_sob)
            cry_mod[sob_start:sob_start + sob_dur] *= cry_osc
    signal *= cry_mod

    signal = normalize_audio(signal, target_peak=0.85)
    return signal


def generate_call_102(sr: int = SAMPLE_RATE) -> np.ndarray:
    """
    Call 102 — Nervous Informant (Ransomware Tip)
    Male voice, ~10 seconds.
    High nervousness & urgency, whispery quality.
    """
    duration = 10.0
    n_samples = int(duration * sr)

    # Male voice formants
    formants = [
        (600, 100),    # F1
        (1100, 130),   # F2
        (2400, 180),   # F3
        (3200, 220),   # F4
    ]

    # Irregular rhythm with hesitation pauses — slightly faster than normal
    syllable_durations = [
        140, 120, 100,             # "Listen..."
        160, 130, 150, 120,        # "I can't talk long"
        100,                        # hesitation
        180, 140, 160, 120, 150,   # "there's a group operating"
        130, 100, 140, 160,        # "from... they're planning"
        150, 120, 180, 140, 160,   # "a ransomware attack"
        120, 140, 180, 160,        # "on the municipal server"
        140, 120, 160, 140,        # "malware is already planted"
        120, 150, 180, 140, 160,   # "check the backup systems"
        140, 120, 160, 180, 120,   # "send proof secure email"
    ]

    pause_durations = [
        30, 25, 180,   # hesitation after "Listen..."
        25, 30, 25, 220,
        300,            # long nervous pause
        25, 30, 20, 25, 150,
        30, 200, 25, 30,    # pause after "from..."
        25, 20, 30, 25, 100,
        25, 30, 25, 80,
        25, 20, 30, 25,
        25, 30, 25, 20, 80,
        25, 20, 30, 25,
    ]

    # Synthesize with whispery quality (high breathiness)
    voiced = synthesize_voiced_speech(
        duration_sec=duration,
        f0_mean=160.0,
        f0_variance=30.0,
        jitter_pct=4.0,
        shimmer_pct=5.0,
        vibrato_rate=5.0,
        vibrato_depth=3.0,
        tremor_rate=4.5,
        tremor_depth=0.12,
        formants=formants,
        syllable_durations_ms=syllable_durations,
        pause_durations_ms=pause_durations,
        pitch_contour_type="erratic",
        breathiness=0.45,  # High breathiness for whisper quality
        sr=sr,
    )

    # Add heavy breathing between phrases
    breath_times = [1.2, 3.5, 5.8, 8.0]
    for bt in breath_times:
        breath = generate_breathing_sound(0.4, sr=sr)
        start = int(bt * sr)
        end = min(start + len(breath), n_samples)
        if start < n_samples:
            voiced[start:end] += breath[:end - start] * 1.5  # Louder breathing

    # Background: very quiet environment (informant hiding)
    white = generate_white_noise(n_samples) * 0.008

    signal = voiced + white
    signal = add_telephone_effect(signal, sr=sr)

    # Add nervous swallow sounds (brief amplitude dips)
    for swallow_time in [2.8, 6.5]:
        sw_start = int(swallow_time * sr)
        sw_dur = int(0.15 * sr)
        if sw_start + sw_dur < n_samples:
            t_sw = np.arange(sw_dur) / sr
            dip = 0.3 + 0.7 * (t_sw / (sw_dur / sr))
            signal[sw_start:sw_start + sw_dur] *= dip

    signal = normalize_audio(signal, target_peak=0.65)  # Lower overall level (whispering)
    return signal


def generate_call_103(sr: int = SAMPLE_RATE) -> np.ndarray:
    """
    Call 103 — Angry Caller (Account Compromise)
    Male voice, ~11 seconds.
    High anger & agitation, loud bursts.
    """
    duration = 11.0
    n_samples = int(duration * sr)

    # Male voice formants — slightly broader bandwidths for harsh quality
    formants = [
        (550, 130),    # F1
        (1050, 160),   # F2
        (2500, 220),   # F3
        (3400, 280),   # F4
        (4200, 300),   # F5 — extra high-frequency energy for harshness
    ]

    # Fast, clipped speech segments with aggressive rhythm
    syllable_durations = [
        120, 100, 90, 130, 100,    # "What the HELL is going on"
        140, 110, 120, 130,        # "My entire savings"
        100, 90, 120, 110, 130,    # "account has been WIPED"
        100, 90,                    # "OUT!"
        130, 110, 100, 120, 90,    # "I've been calling"
        110, 100, 120, 130,        # "your helpline"
        100, 90, 120, 100,         # "for TWO HOURS"
        130, 110, 100, 120, 90,    # "Someone cloned my"
        100, 130, 110, 120,        # "SIM card and"
        100, 90, 120, 130, 110,    # "bypassed authentication"
        100, 120, 100, 130, 110,   # "want cyber cell HEAD"
        90, 100, 120, 100,         # "on the phone NOW"
    ]

    pause_durations = [
        20, 15, 20, 15, 40,
        20, 15, 20, 30,
        15, 20, 15, 20, 50,
        80,                         # angry breath
        20, 15, 20, 15, 30,
        15, 20, 15, 40,
        20, 15, 20, 60,
        15, 20, 15, 20, 30,
        15, 20, 15, 40,
        15, 20, 15, 20, 50,
        15, 20, 15, 20, 30,
        15, 20, 15,
    ]

    # Base synthesis — low jitter but high energy
    voiced = synthesize_voiced_speech(
        duration_sec=duration,
        f0_mean=130.0,
        f0_variance=40.0,
        jitter_pct=2.5,
        shimmer_pct=3.0,
        vibrato_rate=4.0,
        vibrato_depth=2.0,
        tremor_rate=3.0,
        tremor_depth=0.05,
        formants=formants,
        syllable_durations_ms=syllable_durations,
        pause_durations_ms=pause_durations,
        pitch_contour_type="erratic",
        breathiness=0.05,
        sr=sr,
    )

    # Add angry pitch spikes — sudden jumps to ~200Hz at shouted words
    # "HELL" at ~1.0s, "WIPED" at ~3.5s, "TWO HOURS" at ~6.0s, "NOW" at ~10.5s
    spike_times = [
        (0.8, 0.3, 200),
        (3.3, 0.25, 210),
        (5.8, 0.35, 195),
        (10.2, 0.3, 220),
    ]
    for spike_start, spike_dur, spike_f0 in spike_times:
        s = int(spike_start * sr)
        d = int(spike_dur * sr)
        if s + d < n_samples:
            # Generate a brief high-pitched burst
            t_spike = np.arange(d) / sr
            spike_signal = np.sin(2 * np.pi * spike_f0 * t_spike)
            # Apply formant filter to the spike
            spike_filtered = formant_filter(
                spike_signal,
                [(600, 150), (1100, 180), (2800, 250), (3800, 300)],
                sr=sr,
            )
            # Envelope for smooth transition
            env = create_syllable_envelope(d, attack_frac=0.1, decay_frac=0.2)
            spike_filtered *= env * 1.5  # Louder than surrounding speech
            voiced[s:s + d] = voiced[s:s + d] * 0.3 + spike_filtered * 0.7

    # Aggressive amplitude envelope — loud bursts
    loud_envelope = np.ones(n_samples)
    # Make certain segments louder (shouted words)
    for burst_time, burst_dur in [(0.8, 0.4), (3.3, 0.35), (5.8, 0.4), (10.0, 0.5)]:
        bs = int(burst_time * sr)
        bd = int(burst_dur * sr)
        if bs + bd < n_samples:
            loud_envelope[bs:bs + bd] = 1.8  # 80% louder

    voiced *= loud_envelope

    # Add high spectral energy (harsh voice quality)
    # Add some distortion-like harmonics
    harsh_harmonics = np.tanh(voiced * 3.0) * 0.3
    voiced = voiced + harsh_harmonics

    # Background noise — slightly elevated (angry environment)
    pink = generate_pink_noise(n_samples) * 0.02

    signal = voiced + pink
    signal = add_telephone_effect(signal, sr=sr)

    signal = normalize_audio(signal, target_peak=0.95)  # High amplitude — angry
    return signal


def generate_call_104(sr: int = SAMPLE_RATE) -> np.ndarray:
    """
    Call 104 — Suspected Vishing Caller
    Male voice (controlled), ~10 seconds.
    Controlled/deceptive baseline with micro-nervousness spikes.
    """
    duration = 10.0
    n_samples = int(duration * sr)

    # Male voice formants — smooth and measured
    formants = [
        (500, 90),     # F1
        (1000, 110),   # F2
        (2300, 160),   # F3
        (3100, 200),   # F4
    ]

    # Smooth, measured cadence — even syllable durations
    syllable_durations = [
        180, 160, 170, 150, 180,    # "Good morning officer"
        170, 160, 180, 170, 160,    # "I am calling from"
        180, 170, 160, 180,         # "the Reserve Bank"
        170, 160, 180, 170, 150,    # "compliance department"
        180, 170, 160, 170, 180,    # "We have detected"
        160, 170, 180, 170,         # "suspicious activity"
        160, 180, 170, 160, 170,    # "on accounts in your"
        180, 170, 160, 180, 170,    # "jurisdiction I need"
        160, 170, 180, 170, 160,    # "you to verify the nodal"
        170, 180, 160, 170, 180,    # "officer credentials share"
        160, 170, 180, 170,         # "secure access token"
    ]

    pause_durations = [
        50, 45, 50, 45, 60,
        45, 50, 45, 50, 55,
        50, 45, 50, 60,
        45, 50, 45, 50, 55,
        50, 45, 50, 45, 60,
        45, 50, 45, 55,
        50, 45, 50, 45, 55,
        50, 45, 50, 45, 60,
        45, 50, 45, 50, 55,
        50, 45, 50, 45, 60,
        45, 50, 45,
    ]

    # Very controlled synthesis — low jitter, low shimmer
    voiced = synthesize_voiced_speech(
        duration_sec=duration,
        f0_mean=140.0,
        f0_variance=8.0,   # Very low variance — controlled
        jitter_pct=1.5,
        shimmer_pct=2.0,
        vibrato_rate=4.5,
        vibrato_depth=1.5,
        tremor_rate=3.0,
        tremor_depth=0.03,
        formants=formants,
        syllable_durations_ms=syllable_durations,
        pause_durations_ms=pause_durations,
        pitch_contour_type="controlled",
        breathiness=0.03,
        sr=sr,
    )

    # --- Inject micro-nervousness spikes every 2-3 seconds ---
    # These are brief (200-300ms) jitter/pitch bumps that betray the caller's
    # hidden nervousness despite the controlled facade.
    micro_spike_times = [2.2, 4.5, 7.0, 9.3]
    for spike_time in micro_spike_times:
        spike_dur_ms = np.random.uniform(200, 300)
        spike_dur_samples = int(spike_dur_ms / 1000.0 * sr)
        spike_start = int(spike_time * sr)
        spike_end = min(spike_start + spike_dur_samples, n_samples)
        actual_dur = spike_end - spike_start

        if actual_dur > 0:
            # Brief pitch bump: +15-25 Hz
            pitch_bump = np.random.uniform(15, 25)
            t_spike = np.arange(actual_dur) / sr
            # Smooth onset/offset of the bump
            bump_env = np.sin(np.pi * np.arange(actual_dur) / actual_dur)

            # Create a modulation signal that temporarily raises pitch
            freq_mod = 1.0 + (pitch_bump / 140.0) * bump_env
            mod_tone = np.sin(2 * np.pi * 140 * np.cumsum(freq_mod) / sr)

            # Add jitter spike
            jitter_noise = np.random.randn(actual_dur) * 0.04 * bump_env

            # Blend the spike into the existing signal
            original_segment = voiced[spike_start:spike_end].copy()
            spike_blend = original_segment * (1.0 + 0.15 * bump_env) + jitter_noise * np.max(np.abs(original_segment))

            # Also add slight shimmer increase
            shimmer_noise = 1.0 + 0.06 * bump_env * np.random.randn(actual_dur)
            spike_blend *= shimmer_noise

            voiced[spike_start:spike_end] = spike_blend

    # Clean background — professional environment
    pink = generate_pink_noise(n_samples) * 0.005

    signal = voiced + pink
    signal = add_telephone_effect(signal, sr=sr)

    signal = normalize_audio(signal, target_peak=0.75)  # Moderate, controlled level
    return signal


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------

CALL_METADATA = {
    "call_101_victim_upi_fraud.wav": {
        "caller_id": "+91-XXXXXX4821",
        "caller_type": "Distressed Victim",
        "crime_type": "UPI Fraud - Unauthorized Debit",
        "priority_tag": "CRITICAL - GOLDEN HOUR",
        "transcript": (
            "Hello? Please help me! Someone... someone has taken money from my account! "
            "I received an OTP and before I could... they did a digital arrest... my UPI... "
            "₹2,45,000 is gone! Please freeze my account! I'm begging you!"
        ),
        "keywords_detected": [
            "OTP shared",
            "digital arrest",
            "UPI unauthorized debit",
            "account freeze",
        ],
        "timestamp": "2024-10-25T08:47:12+05:30",
        "duration_sec": 12.0,
    },
    "call_102_informant_ransomware_tip.wav": {
        "caller_id": "+91-XXXXXX7293",
        "caller_type": "Informant Tip",
        "crime_type": "Ransomware Attack Intelligence",
        "priority_tag": "HIGH URGENCY",
        "transcript": (
            "Listen... I can't talk long... there's a group operating from... "
            "they're planning a ransomware attack on the municipal server... "
            "the malware is already planted... you need to check the backup systems... "
            "I'll send proof to the secure email..."
        ),
        "keywords_detected": [
            "ransomware",
            "malware",
            "municipal server",
            "secure email",
        ],
        "timestamp": "2024-10-25T08:52:35+05:30",
        "duration_sec": 10.0,
    },
    "call_103_angry_account_compromise.wav": {
        "caller_id": "+91-XXXXXX1056",
        "caller_type": "Distressed Victim",
        "crime_type": "Bank Account Compromise",
        "priority_tag": "HIGH URGENCY",
        "transcript": (
            "What the HELL is going on?! My entire savings account has been WIPED OUT! "
            "I've been calling your helpline for TWO HOURS! Someone cloned my SIM card "
            "and bypassed the authentication! I want the cyber cell HEAD on the phone NOW!"
        ),
        "keywords_detected": [
            "SIM clone",
            "authentication bypass",
            "savings wiped",
            "cyber cell",
        ],
        "timestamp": "2024-10-25T09:01:48+05:30",
        "duration_sec": 11.0,
    },
    "call_104_suspected_vishing_caller.wav": {
        "caller_id": "+91-XXXXXX5580",
        "caller_type": "Suspected Fraudster / Vishing",
        "crime_type": "Vishing / Social Engineering Attempt",
        "priority_tag": "MODERATE",
        "transcript": (
            "Good morning officer. I am calling from the Reserve Bank compliance department. "
            "We have detected suspicious activity on accounts in your jurisdiction. "
            "I need you to verify the nodal officer credentials and share the secure access "
            "token for the banking portal."
        ),
        "keywords_detected": [
            "Reserve Bank impersonation",
            "credential request",
            "access token phishing",
            "social engineering",
        ],
        "timestamp": "2024-10-25T09:15:22+05:30",
        "duration_sec": 10.0,
    },
}


# ---------------------------------------------------------------------------
# Main Orchestration
# ---------------------------------------------------------------------------

def generate_all() -> str:
    """
    Generate all 4 demo call WAV files and the metadata JSON.

    Returns
    -------
    str
        Absolute path to the ``sample_calls/`` directory containing the
        generated files.
    """
    # Determine output directory relative to *this script's* location
    script_dir = Path(os.path.dirname(os.path.abspath(__file__)))
    output_dir = script_dir / "sample_calls"
    output_dir.mkdir(parents=True, exist_ok=True)

    generators = [
        ("call_101_victim_upi_fraud.wav", generate_call_101,
         "Call 101 — Distressed Victim (UPI Fraud, female, ~12s)"),
        ("call_102_informant_ransomware_tip.wav", generate_call_102,
         "Call 102 — Nervous Informant (Ransomware Tip, male, ~10s)"),
        ("call_103_angry_account_compromise.wav", generate_call_103,
         "Call 103 — Angry Caller (Account Compromise, male, ~11s)"),
        ("call_104_suspected_vishing_caller.wav", generate_call_104,
         "Call 104 — Suspected Vishing Caller (male, ~10s)"),
    ]

    for filename, gen_func, label in generators:
        print(f"[*] Generating {label} ...")
        audio = gen_func(sr=SAMPLE_RATE)

        # Ensure the audio length is correct (pad or trim)
        expected_samples = int(CALL_METADATA[filename]["duration_sec"] * SAMPLE_RATE)
        if len(audio) < expected_samples:
            audio = np.concatenate([audio, np.zeros(expected_samples - len(audio))])
        elif len(audio) > expected_samples:
            audio = audio[:expected_samples]

        filepath = output_dir / filename
        sf.write(str(filepath), audio, SAMPLE_RATE, subtype=BIT_DEPTH_SUBTYPE)
        print(f"    Saved: {filepath}")

    # Write metadata JSON
    metadata_path = output_dir / "call_metadata.json"
    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(CALL_METADATA, f, indent=2, ensure_ascii=False)
    print(f"[*] Metadata written: {metadata_path}")

    print(f"\n[Done] All files generated in: {output_dir}")
    return str(output_dir)


if __name__ == "__main__":
    generate_all()
