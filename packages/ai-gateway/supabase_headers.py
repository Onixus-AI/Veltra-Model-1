"""Authenticate server calls with either modern Supabase secret keys or legacy JWTs."""


def service_headers(key: str) -> dict[str, str]:
    headers = {"apikey": key}
    # Legacy service_role keys are JWTs. New sb_secret_ keys must not be sent
    # as bearer tokens: Supabase attempts JWT verification and rejects them.
    if key.count(".") == 2 and not key.startswith("sb_"):
        headers["Authorization"] = f"Bearer {key}"
    return headers
