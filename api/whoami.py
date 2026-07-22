from http.server import BaseHTTPRequestHandler
import json
import base64


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


class handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        username = get_username(self.headers)
        self.send_response(200 if username else 401)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.end_headers()
        self.wfile.write(json.dumps({"username": username}).encode("utf-8"))
