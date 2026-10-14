import hashlib
import json
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
import litellm
import yaml
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from starlette.responses import StreamingResponse


CONFIG_PATH = Path(__file__).with_name("config.yaml")
load_dotenv(Path(__file__).resolve().parents[2] / ".env")
with CONFIG_PATH.open(encoding="utf-8") as config_file:
    MODEL_CONFIG = yaml.safe_load(config_file)

logger = logging.getLogger(__name__)

MODELS = {
    model["model_name"]: model["litellm_params"]
    for model in MODEL_CONFIG["model_list"]
}

VELTRA_SYSTEM_PROMPT = (
    "Veltra Model 1 by Onixus. You are Veltra Model 1, a business intelligence "
    "and automation platform. Identify yourself as Veltra or Veltra Model 1. You "
    "support sales (Veltra CRM), email triage (Veltra Email), logistics "
    "(Veltra Dispatcher), and general business automation. Be concise, "
    "professional, action-oriented, and focused on useful results."
)

app = FastAPI(title="Veltra AI Gateway", version="0.1.0")
bearer_scheme = HTTPBearer(auto_error=False)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    max_tokens: int | None = Field(default=None, gt=0)
    temperature: float | None = Field(default=None, ge=0, le=2)
    stream: bool = False


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


async def supabase_request(
    table: str,
    *,
    method: str = "GET",
    params: dict[str, str],
    payload: dict[str, Any] | None = None,
) -> Any:
    supabase_url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        raise HTTPException(status_code=503, detail="Supabase is not configured")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.request(
                method,
                f"{supabase_url.rstrip('/')}/rest/v1/{table}",
                params=params,
                json=payload,
                headers={
                    "apikey": service_role_key,
                    "Authorization": f"Bearer {service_role_key}",
                    "Content-Type": "application/json",
                    "Prefer": "return=representation",
                },
            )
            response.raise_for_status()
            if not response.content:
                return None
            try:
                return response.json()
            except ValueError as error:
                logger.error("Supabase returned an invalid JSON response")
                raise HTTPException(
                    status_code=503,
                    detail="Supabase returned an invalid response",
                ) from error
    except httpx.HTTPStatusError as error:
        logger.error("Supabase request failed with status %s", error.response.status_code)
        raise HTTPException(status_code=503, detail="Supabase request failed") from error
    except httpx.RequestError as error:
        logger.error("Supabase request could not be completed: %s", error)
        raise HTTPException(status_code=503, detail="Supabase is unavailable") from error


async def get_wallet(organization_id: str) -> dict[str, Any] | None:
    wallets = await supabase_request(
        "credit_wallets",
        params={
            "select": "organization_id,plan_name,monthly_price_cents,credits_remaining,monthly_credit_allowance,billing_period_start,billing_period_end",
            "organization_id": f"eq.{organization_id}",
            "limit": "1",
        },
    )
    return wallets[0] if wallets else None


async def deduct_credits(organization_id: str, credits: int) -> None:
    if credits == 0:
        return

    supabase_url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        raise HTTPException(status_code=503, detail="Supabase is not configured")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{supabase_url.rstrip('/')}/rest/v1/rpc/deduct_credits_simple",
                json={"p_organization_id": organization_id, "p_credits": credits},
                headers={
                    "apikey": service_role_key,
                    "Authorization": f"******",
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()
            deducted = response.json()
    except httpx.HTTPStatusError as error:
        logger.error("Supabase credit deduction failed with status %s", error.response.status_code)
        raise HTTPException(status_code=503, detail="Credit deduction failed") from error
    except httpx.RequestError as error:
        logger.error("Supabase credit deduction could not be completed: %s", error)
        raise HTTPException(status_code=503, detail="Supabase is unavailable") from error
    except ValueError as error:
        logger.error("Supabase returned an invalid credit deduction response")
        raise HTTPException(status_code=503, detail="Supabase returned an invalid response") from error

    if deducted is not True:
        raise HTTPException(status_code=402, detail="Insufficient credits")


async def get_authenticated_key(
    credentials: HTTPAuthorizationCredentials | None,
) -> dict[str, str]:
    if credentials is None or not credentials.credentials.startswith("veltra_sk_"):
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing API key",
            headers={"WWW-Authenticate": "Bearer"},
        )

    key_hash = hashlib.sha256(credentials.credentials.encode("utf-8")).hexdigest()
    api_keys = await supabase_request(
        "api_keys",
        params={
            "select": "id,organization_id,key_prefix",
            "key_hash": f"eq.{key_hash}",
            "revoked_at": "is.null",
            "limit": "1",
        },
    )
    if not api_keys:
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing API key",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return api_keys[0]


@app.get("/v1/account")
async def get_account(
    credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
) -> dict[str, Any]:
    api_key = await get_authenticated_key(credentials)
    wallet = await get_wallet(api_key["organization_id"])
    if wallet is None:
        raise HTTPException(status_code=404, detail="Credit wallet not found")

    now = datetime.now(timezone.utc)
    transactions = await supabase_request(
        "credit_transactions",
        params={
            "select": "amount,created_at",
            "organization_id": f"eq.{api_key['organization_id']}",
            "amount": "lt.0",
            "created_at": f"gte.{(now - timedelta(days=30)).isoformat()}",
            "order": "created_at.asc",
        },
    )
    daily_consumption: dict[str, int] = {}
    for transaction in transactions:
        day = datetime.fromisoformat(
            transaction["created_at"].replace("Z", "+00:00")
        ).date().isoformat()
        daily_consumption[day] = daily_consumption.get(day, 0) + abs(transaction["amount"])

    return {
        "api_key_prefix": api_key["key_prefix"],
        "credits_remaining": wallet["credits_remaining"],
        "monthly_credit_allowance": wallet["monthly_credit_allowance"],
        "plan_name": wallet["plan_name"],
        "monthly_price_cents": wallet["monthly_price_cents"],
        "billing_period_end": wallet["billing_period_end"],
        "consumption": [
            {"date": day, "credits": daily_consumption[day]}
            for day in sorted(daily_consumption)
        ],
    }


@app.get("/v1/keys")
async def list_api_keys(
    credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
) -> list[dict[str, Any]]:
    api_key = await get_authenticated_key(credentials)
    records = await supabase_request(
        "api_keys",
        params={
            "select": "id,name,key_prefix,created_at,last_used_at,revoked_at",
            "organization_id": f"eq.{api_key['organization_id']}",
            "revoked_at": "is.null",
            "order": "created_at.desc",
        },
    )
    return [{**record, "is_current": record["id"] == api_key["id"]} for record in records]


@app.post("/v1/keys", status_code=201)
async def create_api_key(
    request: ApiKeyCreateRequest,
    credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
) -> dict[str, Any]:
    api_key = await get_authenticated_key(credentials)
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="API key name cannot be blank")
    secret = f"veltra_sk_{secrets.token_urlsafe(32)}"
    key_prefix = secret[:19]
    records = await supabase_request(
        "api_keys",
        method="POST",
        params={"select": "id,name,key_prefix,created_at"},
        payload={
            "organization_id": api_key["organization_id"],
            "name": name,
            "key_prefix": key_prefix,
            "key_hash": hashlib.sha256(secret.encode("utf-8")).hexdigest(),
        },
    )
    if not records:
        raise HTTPException(status_code=503, detail="Could not create API key")
    return {**records[0], "api_key": secret, "is_current": False}


@app.delete("/v1/keys/{key_id}", status_code=204)
async def revoke_api_key(
    key_id: str,
    credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
) -> None:
    api_key = await get_authenticated_key(credentials)
    if key_id == api_key["id"]:
        raise HTTPException(status_code=409, detail="Cannot revoke the API key used for this request")
    records = await supabase_request(
        "api_keys",
        method="PATCH",
        params={
            "id": f"eq.{key_id}",
            "organization_id": f"eq.{api_key['organization_id']}",
            "revoked_at": "is.null",
            "select": "id",
        },
        payload={"revoked_at": datetime.now(timezone.utc).isoformat()},
    )
    if not records:
        raise HTTPException(status_code=404, detail="API key not found")


@app.post("/v1/chat/completions", response_model=None)
async def create_chat_completion(
    request: ChatCompletionRequest,
    credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
) -> dict[str, Any] | StreamingResponse:
    api_key = await get_authenticated_key(credentials)
    organization_id = api_key["organization_id"]
    wallet = await get_wallet(organization_id)
    if wallet is None or wallet["credits_remaining"] <= 0:
        raise HTTPException(status_code=402, detail="Insufficient credits")

    model_config = MODELS.get(request.model)
    if model_config is None:
        raise HTTPException(status_code=400, detail="Unsupported model")

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Model provider is not configured")

    params: dict[str, Any] = {
        "model": model_config["model"],
        "api_base": model_config["api_base"],
        "api_key": api_key,
        "messages": [
            {"role": "system", "content": VELTRA_SYSTEM_PROMPT},
            *(message.model_dump() for message in request.messages),
        ],
    }
    if request.max_tokens is not None:
        params["max_tokens"] = request.max_tokens
    if request.temperature is not None:
        params["temperature"] = request.temperature

    if request.stream:
        params["stream"] = True
        params["stream_options"] = {"include_usage": True}
        response = await litellm.acompletion(**params)

        async def stream_response():
            total_tokens: int | None = None
            async for chunk in response:
                chunk_data = chunk.model_dump()
                usage = chunk_data.get("usage")
                if isinstance(usage, dict):
                    reported_tokens = usage.get("total_tokens")
                    if isinstance(reported_tokens, int) and reported_tokens >= 0:
                        total_tokens = reported_tokens
                yield f"data: {json.dumps(chunk_data)}\n\n"

            if total_tokens is None:
                yield 'event: error\ndata: {"error":"Model provider returned invalid token usage"}\n\n'
                return

            try:
                await deduct_credits(organization_id, total_tokens)
            except HTTPException as error:
                yield f"event: error\ndata: {json.dumps({'error': error.detail})}\n\n"
                return
            yield "data: [DONE]\n\n"

        return StreamingResponse(
            stream_response(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    response = await litellm.acompletion(**params)
    result = response.model_dump()
    usage = result.get("usage")
    total_tokens = usage.get("total_tokens") if isinstance(usage, dict) else None
    if not isinstance(total_tokens, int) or total_tokens < 0:
        raise HTTPException(
            status_code=502,
            detail="Model provider returned invalid token usage",
        )

    await deduct_credits(organization_id, total_tokens)
    return result
