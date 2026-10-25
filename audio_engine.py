import numpy as np
import soundfile as sf
import librosa
import librosa.feature
import hashlib
import re
from typing import Dict, List, Tuple, Optional

class AcousticFeatureExtractor:
    def __init__(self, sr: int = 16000, frame_length_ms: float = 500, hop_length_ms: float = 250):
        self.sr = sr
        self.frame_length_samples = int(sr * frame_length_ms / 1000)
        self.hop_length_samples = int(sr * hop_length_ms / 1000)
        self.frame_length_sec = self.frame_length_samples / sr
        self.hop_length_sec = self.hop_length_samples / sr

    def _resample_if_needed(self, signal: np.ndarray, target_sr: int) -> Tuple[np.ndarray, int]:
        signal = np.asarray(signal, dtype=np.float32)
        if signal.ndim > 1:
            signal = signal.mean(axis=1)
        if target_sr == self.sr:
            return signal, self.sr
        if not target_sr or target_sr <= 0:
            return signal, self.sr
        return librosa.resample(signal, orig_sr=target_sr, target_sr=self.sr), self.sr

    def _empty_features(self) -> Dict:
        return {'f0_mean': 0.0, 'f0_std': 0.0, 'f0_contour': np.array([]),
                'f0_std_ratio': 0.0, 'jitter_percent': 0.0, 'shimmer_percent': 0.0,
                'rms_energy': np.array([]), 'rms_mean': 0.0, 'rms_std': 0.0,
                'zcr': np.array([]), 'zcr_mean': 0.0, 'spectral_centroid': np.array([]),
                'spectral_centroid_mean': 0.0, 'mfcc': np.zeros((13, 1)), 'mfcc_means': np.zeros(13),
                'speech_rate': 0.0, 'onset_times': np.array([]), 'duration_sec': 0.0,
                'tempo_bpm': 0.0, 'spectral_bandwidth_mean': 0.0, 'spectral_rolloff_mean': 0.0}

    def _safe_mean(self, arr: np.ndarray) -> float:
        return float(np.mean(arr)) if arr.size > 0 else 0.0

    def _safe_std(self, arr: np.ndarray) -> float:
        return float(np.std(arr)) if arr.size > 0 else 0.0

    def extract_features(self, audio_signal: np.ndarray, sr: Optional[int] = None) -> Dict:
        """
        Extract all acoustic features from the entire audio signal.
        Returns a dictionary with time-series arrays and scalar statistics.
        """
        # Normalize to mono float32 at the configured sample rate.
        audio_signal = np.asarray(audio_signal, dtype=np.float32)
        if audio_signal.ndim > 1:
            audio_signal = audio_signal.mean(axis=1)
        if sr is not None:
            audio_signal, sr = self._resample_if_needed(audio_signal, sr)
        else:
            sr = self.sr
        if audio_signal.size == 0:
            return self._empty_features()
        audio_signal = np.nan_to_num(audio_signal, nan=0.0, posinf=0.0, neginf=0.0)

        # Handle silent audio
        if np.max(np.abs(audio_signal)) < 1e-12:
            return self._empty_features()

        # Use the extractor's target sample rate after optional resampling.
        sr = self.sr

        if len(audio_signal) < self.frame_length_samples:
            return self._empty_features() | {'duration_sec': float(len(audio_signal) / sr)}

        # Fundamental frequency (F0) using pyin
        f0, voiced_flag, _ = librosa.pyin(
            y=audio_signal,
            sr=sr,
            fmin=50,
            fmax=1000,
            frame_length=self.frame_length_samples,
            hop_length=self.hop_length_samples,
        )
        # Remove unvoiced frames
        f0 = np.where(voiced_flag, f0, np.nan)
        f0_mean = self._safe_mean(f0[~np.isnan(f0)])
        f0_std = self._safe_std(f0[~np.isnan(f0)])
        f0_contour = f0.copy()

        # Approximate cycle-to-cycle jitter from voiced F0 periods in samples.
        voiced_f0 = f0[~np.isnan(f0)]
        periods_samples = self.sr / voiced_f0 if voiced_f0.size else np.array([])
        if periods_samples.size < 2 or np.mean(periods_samples) <= 0:
            jitter_percent = 0.0
        else:
            jitter_percent = float(np.mean(np.abs(np.diff(periods_samples))) / np.mean(periods_samples) * 100.0)

        # Shimmer percent (amplitude perturbation)
        rms = librosa.feature.rms(
            y=audio_signal,
            frame_length=self.frame_length_samples,
            hop_length=self.hop_length_samples,
        ).flatten()
        if len(rms) < 2:
            shimmer_percent = 0.0
        else:
            shimmer_percent = np.mean(np.abs(np.diff(rms))) / np.mean(rms) * 100.0

        # RMS energy time series
        rms_energy = rms

        # Zero-crossing rate time series
        zcr = librosa.feature.zero_crossing_rate(
            y=audio_signal,
            frame_length=self.frame_length_samples,
            hop_length=self.hop_length_samples,
        ).flatten()

        # Spectral centroid time series
        spectral_centroid = librosa.feature.spectral_centroid(
            y=audio_signal,
            sr=sr,
            n_fft=2048,
            hop_length=self.hop_length_samples,
        ).flatten()

        # MFCC
        mfcc = librosa.feature.mfcc(
            y=audio_signal,
            sr=sr,
            n_mfcc=13,
            n_fft=2048,
            hop_length=self.hop_length_samples,
        )
        mfcc_means = mfcc.mean(axis=1)
        f0_std_ratio = f0_std / f0_mean if f0_mean > 0 else 0.0

        # Speech rate (onsets per second)
        onset_times = librosa.onset_detect(
            y=audio_signal,
            sr=sr,
            hop_length=self.hop_length_samples,
            units='time',
        )
        # Duration and speech rate (onsets per second).
        duration_sec = len(audio_signal) / sr
        speech_rate = len(onset_times) / max(duration_sec, 1e-9)

        # Tempo (BPM) - may be unreliable for speech; fallback to 0
        tempo_bpm = self._estimate_tempo(audio_signal, sr)

        # Spectral bandwidth mean
        spectral_bandwidth = librosa.feature.spectral_bandwidth(
            y=audio_signal,
            sr=sr,
            n_fft=2048,
            hop_length=self.hop_length_samples,
        ).mean()

        # Spectral rolloff mean
        spectral_rolloff = librosa.feature.spectral_rolloff(
            y=audio_signal,
            sr=sr,
            n_fft=2048,
            hop_length=self.hop_length_samples,
        ).mean()

        return {
            'f0_mean': float(f0_mean),
            'f0_std': float(f0_std),
            'f0_contour': f0_contour,
            'f0_std_ratio': float(f0_std_ratio),
            'jitter_percent': float(jitter_percent),
            'shimmer_percent': float(shimmer_percent),
            'rms_energy': rms_energy,
            'rms_mean': self._safe_mean(rms_energy),
            'rms_std': self._safe_std(rms_energy),
            'zcr': zcr,
            'zcr_mean': self._safe_mean(zcr),
            'spectral_centroid': spectral_centroid,
            'spectral_centroid_mean': float(self._safe_mean(spectral_centroid)),
            'mfcc': mfcc,
            'mfcc_means': mfcc_means,
            'speech_rate': float(speech_rate),
            'onset_times': onset_times,
            'duration_sec': float(duration_sec),
            'tempo_bpm': float(tempo_bpm),
            'spectral_bandwidth_mean': float(spectral_bandwidth),
            'spectral_rolloff_mean': float(spectral_rolloff),
        }

    def _estimate_tempo(self, signal: np.ndarray, sr: int) -> float:
        """Simple BPM estimate using autocorrelation; returns 0 if unreliable."""
        try:
            # Compute autocorrelation
            if signal.size < 2 or not np.any(np.isfinite(signal)):
                return 0.0
            onset_env = librosa.onset.onset_strength(y=signal, sr=sr)
            if onset_env.size < 2 or np.max(onset_env) <= 0:
                return 0.0
            tempo = librosa.feature.tempo(onset_envelope=onset_env, sr=sr, aggregate=np.median)
            bpm = float(np.asarray(tempo).reshape(-1)[0])
            return bpm if np.isfinite(bpm) and 20 <= bpm <= 300 else 0.0
        except Exception:
            return 0.0

    def duration_sec(self, audio_signal: Optional[np.ndarray] = None) -> float:
        """Return duration for a signal, or the default analysis-frame duration."""
        if audio_signal is None:
            return self.frame_length_samples / self.sr
        return len(audio_signal) / self.sr

    def extract_windowed_features(self, audio_signal: np.ndarray, sr: Optional[int] = None) -> List[Dict]:
        """
        Analyze audio in sliding windows (frame_length with hop_length overlap).
        Returns a list of dictionaries, each containing:
        - start_sec, end_sec
        - scalar features (means, etc.)
        - emotions: dict of emotion probabilities (0-100)
        """
        audio_signal = np.asarray(audio_signal, dtype=np.float32)
        if audio_signal.ndim > 1:
            audio_signal = audio_signal.mean(axis=1)
        source_sr = self.sr if sr is None else sr
        audio_signal, _ = self._resample_if_needed(audio_signal, source_sr)

        results = []
        if audio_signal.size == 0:
            return results
        # Keep fixed 500 ms windows; pad the final short segment.
        for i in range(0, len(audio_signal), self.hop_length_samples):
            window = audio_signal[i:i + self.frame_length_samples]
            if len(window) < self.frame_length_samples:
                window = np.pad(window, (0, self.frame_length_samples - len(window)))
            if len(window) == 0:
                continue

            # Extract features for this window (global features are computed on the window)
            feats = self.extract_features(window, sr=sr)

            # Compute start/end times
            start_sec = i * self.hop_length_sec
            end_sec = start_sec + self.frame_length_sec

            # Emotion scoring using windowed features (scalar values only)
            emotion_scores = EmotionScorer().score_emotions(feats)

            results.append({
                'start_sec': float(start_sec),
                'end_sec': float(end_sec),
                'f0_mean': feats['f0_mean'],
                'f0_std': feats['f0_std'],
                'jitter_percent': feats['jitter_percent'],
                'shimmer_percent': feats['shimmer_percent'],
                'rms_mean': feats['rms_mean'],
                'rms_std': feats['rms_std'],
                'zcr_mean': feats['zcr_mean'],
                'spectral_centroid_mean': feats['spectral_centroid_mean'],
                'speech_rate': feats['speech_rate'],
                'duration_sec': feats['duration_sec'],
                'tempo_bpm': feats['tempo_bpm'],
                'spectral_bandwidth_mean': feats['spectral_bandwidth_mean'],
                'spectral_rolloff_mean': feats['spectral_rolloff_mean'],
                'emotions': emotion_scores,
            })
        return results


class EmotionScorer:
    def __init__(self):
        # Thresholds and weights for each emotion
        self.weights = {
            'distress': [('pitch_mean', 0.4), ('jitter_percent', 0.3), ('rms_std', 0.3)],
            'fear': [('pitch_mean', 0.4), ('jitter_percent', 0.3), ('onset_rate', 0.3)],
            'anger': [('rms_mean', 0.4), ('spectral_centroid_mean', 0.3), ('onset_rate', 0.3)],
            'nervousness': [('jitter_percent', 0.4), ('f0_std_ratio', 0.3)],
            'calm': [('f0_std_ratio', 0.5), ('jitter_percent', 0.3), ('shimmer_percent', 0.2)],
        }

        # Sigmoid scaling parameters
        self.k = 0.05  # steepness for sigmoid

    def _sigmoid(self, value: float, threshold: float) -> float:
        """Soft thresholding using sigmoid."""
        return 1.0 / (1.0 + np.exp(-self.k * (value - threshold)))

    def score_emotions(self, features: Dict, **_kwargs) -> Dict:
        """
        Compute emotion probabilities (0-100) from acoustic features.
        Returns a dict with keys: distress, fear, anger, nervousness, calm.
        """
        scores = {emo: 0.0 for emo in self.weights.keys()}

        # Helper to compute a normalized score for an indicator
        def indicator_score(name: str, value: float, threshold: float) -> float:
            if name == 'pitch_mean':
                # Higher pitch -> higher distress/fear
                return self._sigmoid(value, threshold)
            elif name == 'jitter_percent':
                # Higher jitter -> higher distress/fear/nervousness
                return self._sigmoid(value, threshold)
            elif name == 'rms_std':
                return self._sigmoid(value, threshold)
            elif name == 'rms_mean':
                return self._sigmoid(value, threshold)
            elif name == 'spectral_centroid_mean':
                return self._sigmoid(value, threshold)
            elif name == 'onset_rate':
                return self._sigmoid(value, threshold)
            elif name == 'f0_std_ratio':
                # Ratio of std to mean; higher indicates instability
                return self._sigmoid(value, threshold)
            elif name == 'f0_std':
                return self._sigmoid(value, threshold)
            elif name == 'shimmer_percent':
                return self._sigmoid(value, threshold)
            else:
                return 0.0

        # Distress
        scores['distress'] = (
            self._sigmoid(features['f0_mean'], 220) * self.weights['distress'][0][1] +
            self._sigmoid(features['jitter_percent'], 4) * self.weights['distress'][1][1] +
            self._sigmoid(features['rms_std'], 0.1) * self.weights['distress'][2][1]
        ) * 100

        # Fear
        scores['fear'] = (
            self._sigmoid(features['f0_mean'], 200) * self.weights['fear'][0][1] +
            self._sigmoid(features['jitter_percent'], 3.5) * self.weights['fear'][1][1] +
            self._sigmoid(features['speech_rate'], 4) * self.weights['fear'][2][1]
        ) * 100

        # Anger
        scores['anger'] = (
            self._sigmoid(features['rms_mean'], 0.15) * self.weights['anger'][0][1] +
            self._sigmoid(features['spectral_centroid_mean'], 2500) * self.weights['anger'][1][1] +
            self._sigmoid(features['speech_rate'], 4) * self.weights['anger'][2][1]
        ) * 100

        # Nervousness
        scores['nervousness'] = (
            self._sigmoid(features.get('jitter_percent', 0.0), 2.5) * self.weights['nervousness'][0][1] +
            self._sigmoid(features['f0_std_ratio'], 0.2) * self.weights['nervousness'][1][1]
        ) * 100

        # Calm
        scores['calm'] = (
            self._sigmoid(1 - features['f0_std_ratio'], 0.1) * self.weights['calm'][0][1] +
            self._sigmoid(1 - features['jitter_percent'], 2) * self.weights['calm'][1][1] +
            self._sigmoid(1 - features['shimmer_percent'], 3) * self.weights['calm'][2][1]
        ) * 100

        # Normalize so they sum to ~100
        total = sum(scores.values())
        if total > 0:
            for emo in scores:
                scores[emo] = round(scores[emo] / total * 100, 2)
        else:
            scores = {emo: 20.0 for emo in scores}

        return scores

    def calculate_urgency_score(self, emotions: Dict, keywords: List[str] = None) -> float:
        """
        Compute a composite Urgency Index (0-100).
        70% from emotion scores, 30% from keyword points.
        """
        # Emotion component (0-100)
        # Weight threat-related emotions rather than summing a normalized vector.
        emotion_score = (0.30 * emotions.get('distress', 0.0) +
                         0.25 * emotions.get('fear', 0.0) +
                         0.20 * emotions.get('anger', 0.0) +
                         0.15 * emotions.get('nervousness', 0.0) +
                         0.10 * (100.0 - emotions.get('calm', 0.0)))

        # Keyword component
        keyword_score = 0
        if keywords:
            for kw in keywords:
                kw_lower = kw.lower()
                if any(critical in kw_lower for critical in ["digital arrest", "extortion", "kidnapping"]):
                    keyword_score += 25
                elif any(high in kw_lower for high in ["otp shared", "upi unauthorized", "account freeze", "ransomware"]):
                    keyword_score += 15
                elif any(mod in kw_lower for mod in ["suspicious activity", "phishing", "sim clone"]):
                    keyword_score += 10
                # Cap at 100
                if keyword_score >= 100:
                    keyword_score = 100
                    break

        # Weighted combination
        urgency = 0.7 * emotion_score + 0.3 * keyword_score
        return max(0.0, min(100.0, urgency))

    def get_urgency_label(self, score: float) -> Tuple[str, str]:
        if 80 <= score <= 100:
            return ("CRITICAL - GOLDEN HOUR", "#FF2A85")
        elif 60 <= score < 80:
            return ("HIGH URGENCY", "#FF6B35")
        elif 40 <= score < 60:
            return ("MODERATE", "#FFC700")
        else:
            return ("LOW", "#00F5D4")

    def generate_xai_reasoning(self, features: Dict, emotions: Dict) -> List[str]:
        """
        Produce human‑readable explanations for the top emotions.
        Returns 3‑5 strings.
        """
        reasons = []

        # Helper to extract a feature description
        def desc_pitch(mean, std):
            return f"Pitch mean ({mean:.1f}Hz) with std {std:.2f}Hz"

        def desc_jitter(jitter):
            return f"Jitter {jitter:.2f}%"

        def desc_shimmer(shimmer):
            return f"Shimmer {shimmer:.2f}%"

        def desc_rms(mean, std):
            return f"RMS energy mean {mean:.3f} with std {std:.3f}"

        # Distress
        if emotions['distress'] >= 30:
            reasons.append(
                f"🔴 DISTRESS detected: {desc_pitch(features['f0_mean'], features['f0_std'])} "
                f"with high vocal jitter ({features['jitter_percent']:.2f}%) indicating tension."
            )

        # Fear
        if emotions['fear'] >= 30:
            reasons.append(
                f"🟡 FEAR indicated: elevated pitch ({features['f0_mean']:.1f}Hz) and rapid onsets "
                f"({len(features['onset_times'])} onsets) with noticeable jitter ({features['jitter_percent']:.2f}%)."
            )

        # Anger
        if emotions['anger'] >= 30:
            reasons.append(
                f"🔴 ANGER shown: high RMS energy ({features['rms_mean']:.3f}) and spectral centroid ({features['spectral_centroid_mean']:.0f}Hz) "
                f"with frequent onsets suggesting abrupt attacks."
            )

        ratio = float(features.get('f0_std_ratio', 0.0))
        # Nervousness
        if emotions['nervousness'] >= 30:
            reasons.append(
                f"🟡 NERVOUSNESS evident: pitch instability ratio ({ratio:.2f}) "
                f"and jitter ({features['jitter_percent']:.2f}%) imply hesitation."
            )

        # Calm
        if emotions['calm'] >= 30:
            reasons.append(
                f"🟢 CALM observed: stable pitch (f0_std/f0_mean = {ratio:.2f}), "
                f"low jitter ({features['jitter_percent']:.2f}%) and shimmer ({features['shimmer_percent']:.2f}%)."
            )

        while len(reasons) < 3:
            reasons.append("ℹ️ Additional acoustic details available upon deeper analysis.")
        return reasons[:5]


class PIIRedactor:
    def __init__(self):
        # Regex patterns
        self.patterns = {
            "phone": re.compile(r'\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}'),
            "aadhaar": re.compile(r'\b\d{4}\s?\d{4}\s?\d{4}\b'),
            "pan": re.compile(r'\b[A-Z]{5}\d{4}[A-Z]\b'),
            "bank_account": re.compile(r'\b\d{9,18}\b'),
            "rupee_amount": re.compile(r'₹\s?\d{1,3}(?:,\d{2})*(?:,\d{3})*(?:,\d{2})*'),  # matches ₹2,45,000 etc.
            "email": re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'),
            "name_after_salutation": re.compile(r'(?:Mr\.|Mrs\.|Shri)\s+[A-Za-z\s]+'),  # will be replaced wholly
        }

    def redact_transcript(self, text: str, mode: str = "full") -> str:
        """
        Redact PII from transcript.
        mode="full": mask phone, aadhaar, PAN, bank accounts, names after salutation, emails, rupee amounts.
        mode="partial": mask only phone numbers and Aadhaar.
        """
        if mode == "partial":
            # Only phone and Aadhaar
            text = re.sub(self.patterns["phone"], lambda m: f"+91-XXXXXX{ m.group(0)[-4:] }", text)
            text = re.sub(self.patterns["aadhaar"], lambda m: "XXXX XXXX " + re.sub(r'\D', '', m.group(0))[-4:], text)
            return text

        # Full mode
        text = re.sub(self.patterns["phone"], lambda m: f"+91-XXXXXX{m.group(0)[-4:]}", text)
        text = re.sub(self.patterns["aadhaar"], lambda m: "XXXX XXXX " + re.sub(r'\D', '', m.group(0))[-4:], text)
        text = re.sub(self.patterns["pan"], lambda m: "XXXXX" + m.group(0)[5:9] + "X", text)
        text = re.sub(self.patterns["bank_account"], lambda m: "XXXXXXXX" + m.group(0)[-4:], text)
        text = re.sub(self.patterns["rupee_amount"], lambda m: "₹X,XX,XXX", text)
        text = re.sub(self.patterns["email"], lambda m: "[REDACTED EMAIL]", text)
        text = re.sub(self.patterns["name_after_salutation"], lambda m: "[REDACTED NAME]", text)
        return text


class AudioIntegrityVerifier:
    def compute_hash(self, audio_path: str) -> str:
        """Compute SHA‑256 hash of the audio file."""
        hash_sha256 = hashlib.sha256()
        with open(audio_path, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_sha256.update(chunk)
        return hash_sha256.hexdigest()

    def verify_integrity(self, audio_path: str, expected_hash: str) -> bool:
        """Verify audio file integrity against a known hash."""
        return self.compute_hash(audio_path) == expected_hash


def analyze_call(audio_path: str, transcript: str = None, keywords: List[str] = None) -> Dict:
    """
    Top‑level convenience function:
    1. Load audio file.
    2. Extract global and windowed features.
    3. Score emotions.
    4. Compute urgency.
    5. Generate XAI reasoning.
    6. Compute audio integrity hash.
    Returns a comprehensive dictionary with all results.
    """
    # Load audio
    audio_data, sr = sf.read(audio_path, dtype='float32')
    if audio_data.ndim > 1:
        # Use first channel if stereo
        audio_data = audio_data[:, 0]

    extractor = AcousticFeatureExtractor(sr=sr, frame_length_ms=500, hop_length_ms=250)

    # Global features
    global_features = extractor.extract_features(audio_data, sr=sr)

    # Windowed features (optional; can be heavy)
    windowed_features = extractor.extract_windowed_features(audio_data, sr=sr)

    # Emotion scoring
    scorer = EmotionScorer()
    emotion_scores = scorer.score_emotions(global_features)

    # Urgency calculation
    urgency = scorer.calculate_urgency_score(emotion_scores, keywords=keywords)

    # Urgency label
    urgency_label, urgency_color = scorer.get_urgency_label(urgency)

    # XAI reasoning (use global features for consistency)
    xai_reasons = scorer.generate_xai_reasoning(global_features, emotion_scores)

    # Audio integrity hash
    audio_hash = AudioIntegrityVerifier().compute_hash(audio_path)

    # Assemble result
    result = {
        "audio_path": audio_path,
        "sample_rate": sr,
        "global_features": global_features,
        "windowed_features": windowed_features,
        "emotion_scores": emotion_scores,
        "urgency_score": round(urgency, 2),
        "urgency_label": urgency_label,
        "urgency_color": urgency_color,
        "xai_reasoning": xai_reasons,
        "audio_hash": audio_hash,
        "integrity_verified": AudioIntegrityVerifier().verify_integrity(audio_path, audio_hash),
    }

    return result


# End of file