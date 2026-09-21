import os
import subprocess
import tempfile
import warnings

warnings.filterwarnings("ignore", category=UserWarning)

from faster_whisper import WhisperModel


def enhance_for_whisper(input_file: str, output_file: str):
    filters = (
        "highpass=f=80,"
        "lowpass=f=8000,"
        "afftdn=nf=-20,"
        "acompressor="
        "threshold=-18dB:"
        "ratio=3:"
        "attack=20:"
        "release=250,"
        "loudnorm=I=-16:TP=-1.5:LRA=11"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-i", input_file, "-af", filters, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", output_file],
        check=True,
        capture_output=True,
    )


class SpeechToText:
    def __init__(self):
        model_size = os.getenv("HF_MODEL", "base")
        self.model = WhisperModel(model_size, device="cpu", compute_type="int8")

    def transcribe(self, audio_file_path: str) -> str:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            enhanced_path = f.name
        try:
            enhance_for_whisper(audio_file_path, enhanced_path)
            segments, _ = self.model.transcribe(
                enhanced_path,
                language="en",
                beam_size=10,
                vad_filter=True,
                condition_on_previous_text=False,
            )
            return " ".join(s.text.strip() for s in segments)
        finally:
            os.remove(enhanced_path)


stt = SpeechToText()
