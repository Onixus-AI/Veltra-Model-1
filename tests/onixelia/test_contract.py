import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('onixelia_server', Path(__file__).parents[2] / 'services/onixelia/server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

class Contract(unittest.TestCase):
    def request(self):
        return {'job_id':'8350462c-2cca-4541-b299-acbc4c5f1162','scope':'internal_daily_plan','snapshot':{'industry':'Business','checked_at':'2026-10-29T00:00:00Z','metrics':{},'priorities':[]}}
    def test_scope_cannot_request_publishing(self):
        body=self.request();body['scope']='publish'
        with self.assertRaises(ValueError):server.validate_request(body)
    def test_credentials_and_payloads_are_not_accepted(self):
        body=self.request();body['token']='private'
        with self.assertRaises(ValueError):server.validate_request(body)
        body=self.request();body['snapshot']['emails']=['private']
        with self.assertRaises(ValueError):server.validate_request(body)
    def test_valid_plan_request(self):
        self.assertEqual(server.validate_request(self.request())['scope'],'internal_daily_plan')
    def test_budget_configuration_required(self):
        with patch.dict('os.environ',{'ONIXELIA_TOKEN':'x'*32,'OPENROUTER_API_KEY':'test','ONIXELIA_MODEL':'test'},clear=True):
            self.assertFalse(server.configured())
    def test_actual_provider_cap_is_checked(self):
        import io
        def response(value):
            class Result(io.BytesIO):
                def __enter__(self):return self
                def __exit__(self,*_):self.close()
            return Result(__import__('json').dumps({'data':value}).encode())
        with patch.dict('os.environ',{'OPENROUTER_API_KEY':'test'},clear=True):
            for value in [{'limit':None,'limit_remaining':100},{'limit':10,'limit_remaining':10},{'limit':5,'limit_remaining':5,'limit_reset':'daily'},{'limit':5,'limit_remaining':0}]:
                with patch.object(server.urllib.request,'urlopen',return_value=response(value)):
                    with self.assertRaises(ValueError):server.verify_budget()
            with patch.object(server.urllib.request,'urlopen',return_value=response({'limit':5,'limit_remaining':4,'limit_reset':None})):
                server.verify_budget()
