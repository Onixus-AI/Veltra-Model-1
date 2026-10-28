"""Mail-only delegated completions. The protected account link selects the tenant, never the caller."""
import hashlib
import json
import os
from uuid import UUID
import httpx
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field
from model_routing import routing_options, ALLOWED

class MailRequest(BaseModel):
    account_id: UUID
    request_id: UUID
    operation: str = Field(min_length=1, max_length=40)
    completion: dict

async def owner_organization(owner):
    url, key = os.environ.get('SUPABASE_URL'), os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        raise HTTPException(503, 'Mail wallet is not configured')
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(url.rstrip('/')+'/auth/v1/admin/users/'+str(UUID(owner)), headers={'apikey':key,'Authorization':'Bearer '+key})
        response.raise_for_status()
        user = response.json()
    metadata = user.get('app_metadata', {})
    try:
        return str(UUID(metadata.get('org_id') or metadata.get('organization_id')))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(403, 'Mail wallet: workspace owner has no verified organization')

def create_router(db, call):
    router = APIRouter()
    @router.post('/v1/mail/completions')
    async def complete(request: MailRequest, authorization: str = Header(default='')):
        if not authorization.startswith('Bearer ') or len(authorization)>200:
            raise HTTPException(401, 'Mail wallet: account authorization required')
        digest = hashlib.sha256(authorization[7:].encode()).hexdigest()
        links = await db('crm_mail_connections', params={'select':'workspace_id,connected_by','account_id':'eq.'+str(request.account_id),'token_hash':'eq.'+digest,'limit':'2'})
        if len(links)!=1:
            raise HTTPException(403, 'Mail wallet: account link is missing or ambiguous')
        workspace = links[0]['workspace_id']
        rows = await db('crm_workspaces', params={'select':'owner_id','id':'eq.'+workspace,'limit':'1'})
        if len(rows)!=1 or rows[0]['owner_id']!=links[0]['connected_by']:
            raise HTTPException(403, 'Mail wallet: workspace ownership changed; reconnect Mail')
        organization = await owner_organization(rows[0]['owner_id'])
        body = request.completion
        encoded = json.dumps(body, sort_keys=True, separators=(',',':'),ensure_ascii=False).encode()
        if len(encoded)>100000 or body.get('stream') or not isinstance(body.get('messages'),list) or not 1<=len(body['messages'])<=50:
            raise HTTPException(400, 'Mail wallet: unsupported completion')
        if any(not isinstance(m,dict) or m.get('role') not in ('system','user','assistant','tool') or not isinstance(m.get('content'),str) for m in body['messages']):
            raise HTTPException(400,'Mail wallet: text messages required')
        tools=body.get('tools',[])
        if not isinstance(tools,list) or len(tools)>16 or any(not isinstance(t,dict) or t.get('type')!='function' for t in tools):
            raise HTTPException(400,'Mail wallet: function tools required')
        model=body.get('model'); models=body.get('models') or [model]
        if not isinstance(models,list) or len(models)>3 or model not in ALLOWED or any(m not in ALLOWED for m in models):
            raise HTTPException(400, 'Mail wallet: unsupported model')
        output=body.get('max_tokens',1500)
        if type(output) is not int or not 1<=output<=8000:
            raise HTTPException(400, 'Mail wallet: invalid output limit')
        # UTF-8 bytes conservatively bound prompt tokens; reserve the full output allowance too.
        budget=len(encoded)+output+1024
        payload={'p_id':str(request.request_id),'p_account':str(request.account_id),'p_workspace':workspace,'p_org':organization,'p_digest':hashlib.sha256(encoded+request.operation.encode()).hexdigest(),'p_budget':budget}
        reservation=await db('rpc/reserve_mail_credits',method='POST',params={},payload=payload)
        state=reservation.get('status')
        if state=='insufficient': raise HTTPException(402,'Mail wallet: insufficient credits; email remains unprocessed')
        if state=='succeeded': return reservation['response']
        if state=='failed': raise HTTPException(502,'Mail model request previously rejected; try the next configured model')
        if state!='reserved': raise HTTPException(409,'Mail wallet: request already claimed or requires reconciliation')
        params={'model':'openrouter/'+model,'api_base':'https://openrouter.ai/api/v1','api_key':os.environ.get('OPENROUTER_API_KEY'),'messages':body['messages'],'max_tokens':output,'temperature':0,'timeout':90,'num_retries':0,
                'extra_body':routing_options(model,models,tools=bool(body.get('tools')))}
        if not params['api_key']:
            await db('rpc/finish_mail_credits',method='POST',params={},payload={'p_id':str(request.request_id),'p_tokens':0,'p_model':model,'p_response':None,'p_status':'failed'})
            raise HTTPException(503,'Mail wallet: provider unavailable')
        if body.get('tools'):
            params['tools']=body['tools']
            if body.get('tool_choice') is not None: params['tool_choice']=body['tool_choice']
        try:
            result=(await call(params)).model_dump()
        except Exception as error:
            # Definite rejected requests have no completion. Timeouts/unknown outcomes retain their hold.
            status=getattr(error,'status_code',None)
            if status in (400,401,403,404,422,429):
                await db('rpc/finish_mail_credits',method='POST',params={},payload={'p_id':str(request.request_id),'p_tokens':0,'p_model':model,'p_response':None,'p_status':'failed'})
                raise HTTPException(502,'Mail model request rejected; unused reservation returned')
            raise HTTPException(409,'Mail wallet: provider outcome uncertain; reservation retained for reconciliation')
        tokens=result.get('usage',{}).get('total_tokens')
        if type(tokens) is not int or not 0<=tokens<=budget:
            raise HTTPException(409,'Mail wallet: provider token receipt requires reconciliation')
        result['onixus_receipt']={'id':str(request.request_id),'provider_id':result.get('id'),'credits':tokens,'app':'mail'}
        result['id']='onixus-mail-'+str(request.request_id)
        settled=await db('rpc/finish_mail_credits',method='POST',params={},payload={'p_id':str(request.request_id),'p_tokens':tokens,'p_model':str(result.get('model') or model),'p_response':result,'p_status':'succeeded'})
        if settled is not True: raise HTTPException(409,'Mail wallet: settlement requires reconciliation')
        return result
    return router
