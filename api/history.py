"""
GET /api/history
Returns the most recent saved extractions (all users), newest first, as
JSON. Backed by the same Redis list "extractions" that /api/save appends to.
"""

from http.server import BaseHTTPRequestHandler
import json
import os
import base64
import urllib.request

HISTORY_LIMIT = 2000


def get_username(headers):
    auth = headers.get("Authorization") or headers.get("authorization")
    if not auth or not auth.startswith("Basic "):
        return None
    try:
        decoded = base64.b64decode(auth[6:]).decode("utf-8")
        sep = decoded.index(":")
        return decoded[:sep]
    except Exception:
        return None


def upstash_command(command):
    url = os.environ.get("UPSTASH_REDIS_REST_URL")
    token = os.environ.get("UPSTASH_REDIS_REST_TOKEN")
    if not url or not token:
        raise RuntimeError(
            "Storage isn't configured. Attach the Upstash Redis integration "
            "to this Vercel project (Marketplace -> Upstash for Redis)."
        )
    req = urllib.request.Request(
        url.rstrip("/"),
        data=json.dumps(command).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=8) as resp:
        return json.loads(resp.read().decode("utf-8"))


class handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _reply(self, status, payload):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode("utf-8"))

    def do_GET(self):
        if not get_username(self.headers):
            return self._reply(401, {"error": "Not authenticated"})
        try:
            result = upstash_command(["LRANGE", "extractions", str(-HISTORY_LIMIT), "-1"])
            raw = result.get("result", []) or []
            entries = []
            for item in raw:
                try:
                    entries.append(json.loads(item))
                except Exception:
                    continue
            entries.reverse()  # newest first
            return self._reply(200, {"entries": entries})
        except Exception as e:
            return self._reply(500, {"error": str(e)[:300], "entries": []})
