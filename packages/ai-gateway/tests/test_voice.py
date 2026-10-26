import base64
import os
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import voice


class Response:
    def __init__(self, content=b'', body=None):
        self.content, self.body = content, body
    def raise_for_status(self): pass
    def json(self): return self.body


class VoiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_openrouter_key_reports_browser_fallback_and_never_charges(self):
        import main
        from fastapi import HTTPException
        wallet, settle = AsyncMock(), AsyncMock()
        with patch.dict(os.environ, {}, clear=True), \
             patch('main.get_authenticated_principal', AsyncMock(return_value={'organization_id': 'test'})), \
             patch('main.get_wallet', wallet), patch('main.settle_credits', settle):
            status = await main.audio_status(None)
            with self.assertRaises(HTTPException) as error:
                await main.create_speech(main.SpeechRequest(text='Hello'), None)
        self.assertEqual((status['provider'], status['speech'], status['transcription']), ('browser', False, False))
        self.assertEqual(error.exception.status_code, 503)
        wallet.assert_not_awaited()
        settle.assert_not_awaited()

    async def test_speech_goes_through_openrouter_with_pinned_elevenlabs_model(self):
        import main
        settle = AsyncMock()
        post = AsyncMock(return_value=Response(content=b'mp3'))
        with patch.dict(os.environ, {'OPENROUTER_API_KEY': 'test-only'}, clear=True), \
             patch('main.get_authenticated_principal', AsyncMock(return_value={'organization_id': 'test'})), \
             patch('main.get_wallet', AsyncMock(return_value={'credits_remaining': 100})), \
             patch('httpx.AsyncClient.post', post), patch('main.settle_credits', settle):
            response = await main.create_speech(main.SpeechRequest(text=' Hello there '), None)
        self.assertEqual((response.body, response.media_type), (b'mp3', 'audio/mpeg'))
        url, body = post.call_args.args[0], post.call_args.kwargs['json']
        self.assertEqual(url, 'https://openrouter.ai/api/v1/audio/speech')
        self.assertEqual(post.call_args.kwargs['headers'], {'Authorization': 'Bearer test-only'})
        self.assertEqual((body['model'], body['input'], body['provider']),
                         ('elevenlabs/eleven-flash-v2.5', 'Hello there', {'data_collection': 'deny'}))
        settle.assert_awaited_once_with('test', 11, 'elevenlabs-tts')

    async def test_transcription_goes_through_openrouter_and_charges_spoken_seconds(self):
        import main
        settle = AsyncMock()
        audio = base64.b64encode(b'webm').decode()
        post = AsyncMock(return_value=Response(body={'text': 'call Dana', 'usage': {'seconds': 31.2}}))
        with patch.dict(os.environ, {'OPENROUTER_API_KEY': 'test-only'}, clear=True), \
             patch('main.get_authenticated_principal', AsyncMock(return_value={'organization_id': 'test'})), \
             patch('main.get_wallet', AsyncMock(return_value={'credits_remaining': 100})), \
             patch('httpx.AsyncClient.post', post), patch('main.settle_credits', settle):
            response = await main.create_transcription(main.TranscriptionRequest(audio_base64=audio), None)
        self.assertEqual(response, {'text': 'call Dana', 'credits': 32})
        body = post.call_args.kwargs['json']
        self.assertEqual(post.call_args.args[0], 'https://openrouter.ai/api/v1/audio/transcriptions')
        self.assertEqual((body['model'], body['input_audio'], body['provider']),
                         ('elevenlabs/scribe-v2', {'data': audio, 'format': 'webm'}, {'data_collection': 'deny'}))
        settle.assert_awaited_once_with('test', 32, 'elevenlabs-stt')

    def test_voice_models_are_pinned_to_elevenlabs_and_no_direct_key_is_used(self):
        from model_routing import POLICY
        for model in (POLICY['voice']['speech_model'], POLICY['voice']['transcription_model']):
            self.assertTrue(model.startswith('elevenlabs/'))
        self.assertNotIn('ELEVENLABS', Path(voice.__file__).read_text())

    def test_transcription_without_duration_has_a_floor(self):
        self.assertEqual(voice.transcription_credits({}, 100), voice.MIN_TRANSCRIPTION_CREDITS)
        self.assertEqual(voice.transcription_credits({'duration': 4.2}, 10**6), 10)
        self.assertEqual(voice.transcription_credits({}, 400_000), 100)
