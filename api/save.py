"""
POST /api/save
Body: { "city": str, "industry": str, "companies": [str, ...] }

Appends one entry per company to a Redis list ("extractions") via the
Upstash REST API, each entry tagged with the username decoded from the
caller's HTTP Basic Auth header (already validated by middleware.js).
Requires the Upstash Redis Marketplace integration to be attached to this
Vercel project, which sets UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.
"""

from http.server import BaseHTTPRequestHandler
import json
import os
import base64
import datetime
import urllib.request
import urllib.error

MAX_HISTORY = 5000


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


def upstash_pipeline(commands):
    url = os.environ.get("UPSTASH_REDIS_REST_URL")
    token = os.environ.get("UPSTASH_REDIS_REST_TOKEN")
    if not url or not token:
        raise RuntimeError(
            "Storage isn't configured. Attach the Upstash Redis integration "
            "to this Vercel project (Marketplace -> Upstash for Redis)."
        )
    req = urllib.request.Request(
        url.rstrip("/") + "/pipeline",
        data=json.dumps(commands).encode("utf-8"),
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
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
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

    def do_POST(self):
        username = get_username(self.headers)
        if not username:
            return self._reply(401, {"error": "Not authenticated"})

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            city = (body.get("city") or "").strip()
            industry = (body.get("industry") or "").strip()
            companies = [c.strip() for c in body.get("companies", []) if c and c.strip()]

            if not companies:
                return self._reply(400, {"error": "No companies to save"})

            now = datetime.datetime.utcnow().isoformat() + "Z"
            entries = [
                json.dumps({
                    "company_name": name,
                    "extracted_by": username,
                    "city": city,
                    "industry": industry,
                    "extracted_at": now,
                })
                for name in companies
            ]

            commands = [
                ["RPUSH", "extractions", *entries],
                ["LTRIM", "extractions", str(-MAX_HISTORY), "-1"],
            ]
            upstash_pipeline(commands)

            return self._reply(200, {"saved": len(entries), "username": username})
        except Exception as e:
            return self._reply(500, {"error": str(e)[:300]})
