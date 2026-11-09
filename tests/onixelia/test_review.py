"""Review must see the same evidence as the planner and reject model substitution."""
import importlib.util
import io
import json
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

class Review(unittest.TestCase):
    def load(self):
        spec = importlib.util.spec_from_file_location('plan_under_test', Path(__file__).parents[2] / 'services/onixelia/run_plan.py')
        module = importlib.util.module_from_spec(spec)
        sys.path.insert(0, str(Path(__file__).parents[2] / 'services/onixelia'))
        fake = types.ModuleType('run_agent'); fake.AIAgent = object
        with patch.dict(os.environ, {'HERMES_SOURCE':'/nonexistent'}), patch.dict(sys.modules, {'run_agent':fake}):
            spec.loader.exec_module(module)
        return module

    def test_reviewer_receives_priority_evidence_and_dated_model(self):
        module = self.load()
        snapshot = {'industry':'Test','checked_at':'2026-11-06','metrics':{},'priorities':['Review draft only']}
        result = {'model':'typesafe/jev-1.14-20261014','answers':{'plan':{'type':'score','score':8,'confidence':0.9}}}
        with patch.dict(os.environ, {'OPENROUTER_API_KEY':'test'}), patch.object(module.urllib.request, 'urlopen', return_value=io.BytesIO(json.dumps(result).encode())) as call:
            review = module.review_plan(snapshot, [])
        payload = json.loads(call.call_args.args[0].data)
        self.assertEqual(json.loads(payload['state'])['priorities'], snapshot['priorities'])
        self.assertEqual(payload['model'], result['model'])
        self.assertEqual(review['decision'], 'review_only')
        self.assertIsNone(review['cost_usd'])

    def test_reviewer_substitution_is_rejected(self):
        module = self.load()
        snapshot = {'industry':'Test','checked_at':'2026-11-06','metrics':{},'priorities':[]}
        result = {'model':'typesafe/jev-1.14-unapproved','answers':{'plan':{'type':'score','score':8,'confidence':0.9}}}
        with patch.dict(os.environ, {'OPENROUTER_API_KEY':'test'}), patch.object(module.urllib.request, 'urlopen', return_value=io.BytesIO(json.dumps(result).encode())):
            with self.assertRaises(RuntimeError): module.review_plan(snapshot, [])
