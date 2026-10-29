"""Narrow internal-planning bridge. No connector credentials or business write tools."""
import hmac
import json
import os
import subprocess
import sys
import tempfile
import threading
import uuid
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

CAPACITY = threading.BoundedSemaphore(1)
MAX_INPUT = 16000

def validate_request(body):
    if not isinstance(body, dict) or set(body) != {"job_id", "scope", "snapshot"}:
        raise ValueError("Invalid request")
    uuid.UUID(body["job_id"])
    if body["scope"] != "internal_daily_plan":
        raise ValueError("Unsupported scope")
    snapshot = body["snapshot"]
    if not isinstance(snapshot, dict) or set(snapshot) != {"industry", "checked_at", "metrics", "priorities"}:
        raise ValueError("Invalid snapshot")
    if not isinstance(snapshot["metrics"], dict) or not isinstance(snapshot["priorities"], list) or len(snapshot["priorities"]) > 8:
        raise ValueError("Invalid snapshot")
    return body

def configured():
    return (len(os.getenv("ONIXELIA_TOKEN", "")) >= 32 and bool(os.getenv("OPENROUTER_API_KEY"))
            and bool(os.getenv("ONIXELIA_MODEL")) and os.getenv("ONIXELIA_BUDGETED_KEY") == "true")

def verify_budget():
    req=urllib.request.Request("https://openrouter.ai/api/v1/key",headers={"Authorization":"Bearer "+os.environ["OPENROUTER_API_KEY"]})
    with urllib.request.urlopen(req,timeout=5) as response:
        raw=response.read(16001)
    if len(raw)>16000: raise ValueError("Invalid budget response")
    data=json.loads(raw).get("data",{})
    limit=data.get("limit"); remaining=data.get("limit_remaining")
    # A dedicated key with a cumulative $5 cap is required; daily/monthly resets could silently exceed the pilot budget.
    if type(limit) not in (int,float) or not 0<limit<=5 or type(remaining) not in (int,float) or remaining<=0 or data.get("limit_reset") is not None:
        raise ValueError("A dedicated non-resetting pilot budget is required")

def execute(body):
    verify_budget()
    # One isolated process per business job. No persisted chat, cross-client memory or inherited app credentials.
    with tempfile.TemporaryDirectory(prefix="onixelia-") as folder:
        env = {k: v for k, v in os.environ.items() if k in {"PATH", "LANG", "LD_LIBRARY_PATH", "SSL_CERT_FILE", "SSL_CERT_DIR"}}
        env.update({"HERMES_HOME": folder, "HERMES_SOURCE": "/opt/hermes", "OPENROUTER_API_KEY": os.environ["OPENROUTER_API_KEY"],
                    "ONIXELIA_MODEL": os.environ["ONIXELIA_MODEL"], "PYTHONDONTWRITEBYTECODE": "1"})
        result = subprocess.run([sys.executable, str(Path(__file__).with_name("run_plan.py"))], input=json.dumps(body),
                                text=True, capture_output=True, cwd=folder, env=env, timeout=32, check=True)
        # The child emits its result on the final line; no raw model logs are returned or logged by the server.
        output = result.stdout.strip().splitlines()[-1]
        if len(output.encode()) > 20000:
            raise ValueError("Oversized result")
        return json.loads(output)

class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, *_):
        pass

    def reply(self, status, value):
        raw = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        self.reply(200 if configured() else 503, {"service": "Onixelia", "configured": configured(), "scope": "internal_daily_plan"})

    def do_POST(self):
        expected = os.getenv("ONIXELIA_TOKEN", "")
        if len(expected) < 32 or not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + expected):
            return self.reply(401, {"error": "Not authorized"})
        if self.path != "/v1/plan":
            return self.reply(404, {"error": "Not found"})
        if not configured():
            return self.reply(503, {"error": "Budgeted model access is not configured"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_INPUT:
                return self.reply(413, {"error": "Request exceeds pilot limit"})
            body = validate_request(json.loads(self.rfile.read(size)))
        except (ValueError, TypeError, KeyError):
            return self.reply(400, {"error": "Invalid planning request"})
        if not CAPACITY.acquire(blocking=False):
            return self.reply(429, {"error": "Worker busy; retry after checking job status"})
        try:
            self.reply(200, execute(body))
        except Exception:
            self.reply(503, {"error": "Planning failed; no external actions were authorized"})
        finally:
            CAPACITY.release()

if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", int(os.getenv("PORT", "8080"))), Handler).serve_forever()
