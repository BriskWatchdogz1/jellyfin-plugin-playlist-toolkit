"""Minimal Jellyfin API client for the local test server (standard library only)."""
import json
import os
import pathlib
import secrets
import urllib.error
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
STATE = HERE / ".state" / "credentials.json"
BASE = os.environ.get("TEST_BASE_URL", f"http://localhost:{os.environ.get('TEST_PORT', '18096')}")

# The scripts create users and delete playlists: only a server on this machine is accepted.
if urllib.parse.urlsplit(BASE).hostname not in ("localhost", "127.0.0.1", "::1"):
    raise SystemExit(f"Refusing to run against {BASE}: only the local test server is allowed.")


class Response:
    def __init__(self, status, body, headers):
        self.status = status
        self.body = body
        self.headers = headers

    def json(self):
        return json.loads(self.body.decode("utf-8")) if self.body else None

    def text(self):
        return self.body.decode("utf-8", "replace")


class Client:
    def __init__(self, name="anonymous", token=None, user_id=None, device_id=None):
        self.name = name
        self.token = token
        self.user_id = user_id
        self.device_id = device_id or f"pt-test-{name}"

    def _auth(self):
        value = f'MediaBrowser Client="PlaylistToolkitTest", Device="script", DeviceId="{self.device_id}", Version="1.0"'
        if self.token:
            value += f', Token="{self.token}"'
        return value

    def request(self, method, path, body=None, params=None, content_type=None, raw=None, headers=None):
        url = BASE + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        data = None
        hdrs = {"Authorization": self._auth()}
        if raw is not None:
            data = raw
            hdrs["Content-Type"] = content_type or "application/octet-stream"
        elif body is not None:
            data = json.dumps(body).encode("utf-8")
            hdrs["Content-Type"] = "application/json"
        if headers:
            hdrs.update(headers)
        req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return Response(resp.status, resp.read(), dict(resp.headers))
        except urllib.error.HTTPError as err:
            return Response(err.code, err.read(), dict(err.headers))

    def get(self, path, **kw):
        return self.request("GET", path, **kw)

    def post(self, path, body=None, **kw):
        return self.request("POST", path, body=body, **kw)

    def delete(self, path, **kw):
        return self.request("DELETE", path, **kw)


def load_state():
    return json.loads(STATE.read_text()) if STATE.exists() else {}


def save_state(state):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, indent=2))
    STATE.chmod(0o600)


def new_password():
    return secrets.token_urlsafe(18)


def login(name, device_id=None):
    """Logs a test user in with the generated password from the state file."""
    state = load_state()
    client = Client(name, device_id=device_id)
    resp = client.post("/Users/AuthenticateByName", {"Username": name, "Pw": state["users"][name]})
    if resp.status != 200:
        raise SystemExit(f"login {name} failed: {resp.status} {resp.text()[:200]}")
    data = resp.json()
    client.token = data["AccessToken"]
    client.user_id = data["User"]["Id"]
    return client
