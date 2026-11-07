import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('onixelia_server', Path(__file__).parents[2] / 'services/onixelia/server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

class Contract(unittest.TestCase):
    def result(self):
        return {'job_id':self.request()['job_id'],'scope':'internal_daily_plan','engine':'hermes',
                'version':'pinned-test','model':'test','usage':None,'tasks':[],
                'review':{'engine':'jev','model':'typesafe/jev-1.14','decision':'review_only','score':8,'confidence':0.8}}
    def test_empty_plan_and_review_are_valid(self):
        with patch.dict('os.environ',{'ONIXELIA_MODEL':'test'}):
            self.assertEqual(server.validate_result(self.result(),self.request())['tasks'],[])
    def test_rejects_invented_sources_and_execution_fields(self):
        with patch.dict('os.environ',{'ONIXELIA_MODEL':'test'}):
            for source in ('business_metrics','business_priority:0','external'):
                result=self.result()
                result['tasks']=[{'title':'Proposal','owner':'onixa','reason':'Review','source':source}]
                with self.assertRaises(ValueError):server.validate_result(result,self.request())
            result=self.result();result['publish']=True
            with self.assertRaises(ValueError):server.validate_result(result,self.request())
    def test_valid_source_index_and_invalid_owner(self):
        body=self.request();body['snapshot']['priorities']=['Review draft']
        with patch.dict('os.environ',{'ONIXELIA_MODEL':'test'}):
            result=self.result()
            result['tasks']=[{'title':'Review draft','owner':'onixa','reason':'Supplied priority','source':'business_priority:0'}]
            server.validate_result(result,body)
            result['tasks'][0]['owner']='publisher'
            with self.assertRaises(ValueError):server.validate_result(result,body)
    def test_review_and_provenance_cannot_be_bypassed(self):
        with patch.dict('os.environ',{'ONIXELIA_MODEL':'test'}):
            for field,value in [('job_id','different'),('model','paid-fallback'),('review',None),('version','')]:
                result=self.result();result[field]=value
                with self.assertRaises(ValueError):server.validate_result(result,self.request())
            result=self.result();result['review']['confidence']=float('nan')
            with self.assertRaises(ValueError):server.validate_result(result,self.request())
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

    def test_duplicate_priority_tasks_are_rejected(self):
        body=self.request();body['snapshot']['priorities']=['Verify accepted job']
        with patch.dict('os.environ',{'ONIXELIA_MODEL':'test'}):
            result=self.result()
            result['tasks']=[{'title':'Verify receipt','owner':'onixelia','reason':'Check accepted job','source':'business_priority:0'},
                             {'title':'Log receipt','owner':'onyx','reason':'Record verification','source':'business_priority:0'}]
            with self.assertRaises(ValueError):server.validate_result(result,body)
            body['snapshot']['priorities'].append('Review another draft')
            result['tasks'][1]['source']='business_priority:1'
            server.validate_result(result,body)
