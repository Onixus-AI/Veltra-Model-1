"""ElevenLabs speech through OpenRouter's audio endpoints, using the gateway's OpenRouter key."""
import math
import os

import httpx

from model_routing import POLICY

API = 'https://openrouter.ai/api/v1'
MAX_SPEECH_CHARS = 2000
MAX_AUDIO_BYTES = 10_000_000
MIN_TRANSCRIPTION_CREDITS = 10
FORMATS = {'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav'}
# Audio requests ignore provider.ignore, so the blocklist is enforced by pinning exact models.
PROVIDER = {'data_collection': 'deny'}


class VoiceUnavailable(Exception):
    pass


def _key():
    key = os.environ.get('OPENROUTER_API_KEY', '').strip()
    if not key:
        raise VoiceUnavailable('OpenRouter is not configured')
    return key


def status():
    configured = bool(os.environ.get('OPENROUTER_API_KEY', '').strip())
    return {'provider': 'elevenlabs' if configured else 'browser', 'speech': configured, 'transcription': configured,
            'speech_model': POLICY['voice']['speech_model'], 'transcription_model': POLICY['voice']['transcription_model']}


def speech_credits(text):
    return len(text)


def transcription_credits(result, audio_bytes):
    # Bill by spoken duration; without it assume low-bitrate (32 kbps) audio.
    usage = result.get('usage') or {}
    seconds = next((value for value in (usage.get('seconds'), result.get('duration'))
                    if isinstance(value, (int, float)) and value >= 0), audio_bytes / 4000)
    return max(MIN_TRANSCRIPTION_CREDITS, math.ceil(seconds))


async def synthesize(client: httpx.AsyncClient, text: str) -> bytes:
    response = await client.post(f'{API}/audio/speech', headers={'Authorization': f'Bearer {_key()}'}, json={
        'model': POLICY['voice']['speech_model'], 'input': text, 'voice': POLICY['voice']['voice'],
        'response_format': 'mp3', 'provider': PROVIDER})
    response.raise_for_status()
    return response.content


async def transcribe(client: httpx.AsyncClient, audio_base64: str, mime_type: str) -> dict:
    response = await client.post(f'{API}/audio/transcriptions', headers={'Authorization': f'Bearer {_key()}'}, json={
        'model': POLICY['voice']['transcription_model'],
        'input_audio': {'data': audio_base64, 'format': FORMATS[mime_type]},
        'response_format': 'verbose_json', 'provider': PROVIDER})
    response.raise_for_status()
    return response.json()
