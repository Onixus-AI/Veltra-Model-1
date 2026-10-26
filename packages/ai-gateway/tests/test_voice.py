import base64
import os
import unittest
from unittest.mock import AsyncMock, patch

import voice


class VoiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_key_reports_browser_fallback_and_never_charges(self):
        import main
        from fastapi import HTTPException
        wallet, settle = AsyncMock(), AsyncMock()
        with patch.dict(os.environ, {}, clear=True), \
             patch('main.get_authenticated_principal', AsyncMock(return_value={'organization_id': 'test'})), \
             patch('main.get_wallet', wallet), patch('main.settle_credits', settle):
            self.assertEqual(await main.audio_status(None), {'provider': 'browser', 'speech': False, 'transcription': False})
            with self.assertRaises(HTTPException) as error:
                await main.create_speech(main.SpeechRequest(text='Hello'), None)
        self.assertEqual(error.exception.status_code, 503)
        wallet.assert_not_awaited()
        settle.assert_not_awaited()

    async def test_speech_uses_server_key_and_charges_per_character(self):
        import main
        settle = AsyncMock()
        synthesize = AsyncMock(return_value=b'mp3')
        with patch.dict(os.environ, {'ELEVENLABS_API_KEY': 'test-only'}), \
             patch('main.get_authenticated_principal', AsyncMock(return_value={'organization_id': 'test'})), \
             patch('main.get_wallet', AsyncMock(return_value={'credits_remaining': 100})), \
             patch('voice.synthesize', synthesize), patch('main.settle_credits', settle):
            response = await main.create_speech(main.SpeechRequest(text=' Hello there '), None)
        self.assertEqual(response.body, b'mp3')
        self.assertEqual(response.media_type, 'audio/mpeg')
        self.assertEqual(synthesize.call_args.args[1], 'Hello there')
        settle.assert_awaited_once_with('test', 11, 'elevenlabs-tts')

    async def test_transcription_charges_spoken_seconds(self):
        import main
        settle = AsyncMock()
        result = {'text': 'call Dana', 'words': [{'text': 'call', 'end': 0.4}, {'text': 'Dana', 'end': 31.2}]}
        with patch.dict(os.environ, {'ELEVENLABS_API_KEY': 'test-only'}), \
             patch('main.get_authenticated_principal', AsyncMock(return_value={'organization_id': 'test'})), \
             patch('main.get_wallet', AsyncMock(return_value={'credits_remaining': 100})), \
             patch('voice.transcribe', AsyncMock(return_value=result)), patch('main.settle_credits', settle):
            response = await main.create_transcription(main.TranscriptionRequest(audio_base64=base64.b64encode(b'webm').decode()), None)
        self.assertEqual(response, {'text': 'call Dana', 'credits': 32})
        settle.assert_awaited_once_with('test', 32, 'elevenlabs-stt')

    def test_transcription_without_timestamps_has_a_floor(self):
        self.assertEqual(voice.transcription_credits({}, 100), voice.MIN_TRANSCRIPTION_CREDITS)
        self.assertEqual(voice.transcription_credits({'words': []}, 400_000), 100)
