"""Optional ElevenLabs speech. Without ELEVENLABS_API_KEY the browser's own speech input stays the only voice path."""
import math
import os

import httpx

API = 'https://api.elevenlabs.io/v1'
# Premade "Rachel" voice, available on every ElevenLabs account.
DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM'
MAX_SPEECH_CHARS = 2000
MAX_AUDIO_BYTES = 10_000_000
MIN_TRANSCRIPTION_CREDITS = 10


class VoiceUnavailable(Exception):
    pass


def _key():
    key = os.environ.get('ELEVENLABS_API_KEY', '').strip()
    if not key:
        raise VoiceUnavailable('ElevenLabs is not configured')
    return key


def status():
    configured = bool(os.environ.get('ELEVENLABS_API_KEY', '').strip())
    return {'provider': 'elevenlabs' if configured else 'browser', 'speech': configured, 'transcription': configured}


def speech_credits(text):
    return len(text)


def transcription_credits(result, audio_bytes):
    # Bill by spoken duration; without timestamps assume low-bitrate (32 kbps) audio.
    ends = [word.get('end') for word in result.get('words') or [] if isinstance(word.get('end'), (int, float))]
    seconds = max(ends) if ends else audio_bytes / 4000
    return max(MIN_TRANSCRIPTION_CREDITS, math.ceil(seconds))


async def synthesize(client: httpx.AsyncClient, text: str) -> bytes:
    voice = os.environ.get('ELEVENLABS_VOICE_ID', '').strip() or DEFAULT_VOICE
    response = await client.post(f'{API}/text-to-speech/{voice}', params={'output_format': 'mp3_44100_128'},
                                 headers={'xi-api-key': _key()},
                                 json={'text': text, 'model_id': os.environ.get('ELEVENLABS_TTS_MODEL', 'eleven_flash_v2_5')})
    response.raise_for_status()
    return response.content


async def transcribe(client: httpx.AsyncClient, audio: bytes, mime_type: str) -> dict:
    response = await client.post(f'{API}/speech-to-text', headers={'xi-api-key': _key()},
                                 data={'model_id': os.environ.get('ELEVENLABS_STT_MODEL', 'scribe_v1')},
                                 files={'file': ('audio', audio, mime_type)})
    response.raise_for_status()
    return response.json()
