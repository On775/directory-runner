"""
Vercel serverless function: one area+keyword Places Text Search (New).

Deliberately scoped to a SINGLE (area, keyword) query per invocation —
the browser orchestrates the full area x keyword loop by calling this
endpoint once per pair. That keeps each function call short enough to
comfortably finish inside Vercel's execution time limit, no matter how
many areas/keywords the user configures on the frontend.
"""

from http.server import BaseHTTPRequestHandler
import json
import time
import urllib.request
import urllib.error

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
MAX_PAGES_CAP = 3
PAGE_DELAY_SECONDS = 1.0
RETRY_DELAY_SECONDS = 1.5
REQUEST_TIMEOUT_SECONDS = 8


def call_places(api_key, body):
    req = urllib.request.Request(
        SEARCH_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": api_key,
            "X-Goog-FieldMask": "places.id,places.displayName,places.types,nextPageToken",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
        return json.loads(resp.read().decode("utf-8"))


def search_one(api_key, city, area, keyword, max_pages):
    max_pages = max(1, min(int(max_pages), MAX_PAGES_CAP))
    results = {}
    page_token = None

    for page in range(max_pages):
        body = {"textQuery": f"{keyword} in {area}, {city}", "pageSize": 20}
        if page_token:
            body["pageToken"] = page_token

        data = None
        for attempt in range(2):
            try:
                data = call_places(api_key, body)
                break
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "ignore") if hasattr(e, "read") else ""
                if e.code == 429 and attempt == 0:
                    time.sleep(RETRY_DELAY_SECONDS)
                    continue
                return {
                    "error": f"HTTP {e.code}: {e.reason} {detail}"[:300],
                    "results": list(results.values()),
                }
            except Exception as e:
                return {"error": str(e)[:300], "results": list(results.values())}

        if data is None:
            break

        for p in data.get("places", []):
            name = p.get("displayName", {}).get("text", "")
            types = p.get("types", [])
            results[p["id"]] = {"id": p["id"], "name": name, "types": types}

        page_token = data.get("nextPageToken")
        if not page_token:
            break
        if page < max_pages - 1:
            time.sleep(PAGE_DELAY_SECONDS)

    return {"error": None, "results": list(results.values())}


class handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            body = json.loads(raw or b"{}")

            api_key = (body.get("apiKey") or "").strip()
            city = (body.get("city") or "").strip()
            area = (body.get("area") or "").strip()
            keyword = (body.get("keyword") or "").strip()
            max_pages = body.get("maxPages", 3)

            if not (api_key and city and area and keyword):
                payload = {"error": "Missing apiKey, city, area, or keyword", "results": []}
                status = 400
            else:
                payload = search_one(api_key, city, area, keyword, max_pages)
                status = 200

            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(json.dumps(payload).encode("utf-8"))
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)[:300], "results": []}).encode("utf-8"))
