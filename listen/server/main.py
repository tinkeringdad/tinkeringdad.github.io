"""Listening server: voices Google Docs one chapter at a time.

Runs on Google Cloud Run in your own project. The reader page talks only to
this server; the server holds no key at all. It runs as the "listening-robot"
account, which may use Text-to-Speech and your private bucket.

Who may use it: only the Google accounts in ALLOWED_EMAILS (set when you
deploy; normally just yours). The page signs you in with Google once, and the
server hands back its own session pass that lasts 30 days.

Storage, in the private bucket:
  docs/<docId>.json             the document split into chapters
  chapters/<docId>/<hash>-<voice>.mp3 / .json   voiced chapters + timings
  samples/<voice>.mp3           voice samples
  library.json                  your Recent list
  usage/<YYYY-MM>.json          characters voiced this month
  server/secret                 signs session passes (made on first start)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import threading
import time
import wave
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import quote

import google.auth
import google.auth.exceptions
import lameenc
import requests
from flask import Flask, Response, abort, jsonify, request
from google.auth.transport.requests import AuthorizedSession

import textprep

BUCKET = os.environ["BUCKET"]
CLIENT_ID = os.environ["CLIENT_ID"]
ALLOWED = {e.strip().lower() for e in os.environ["ALLOWED_EMAILS"].split(",") if e.strip()}
ORIGINS = {"https://tinkeringdad.github.io", "http://localhost:8000"}
FREE_CHARS_PER_MONTH = 1_000_000
SAMPLE_RATE = 24000
LANGS = ("en-US", "en-GB", "en-AU")
SAMPLE_TEXT = "Hello. This is how I sound reading your documents. Tap Listen when you're ready."
CHAPTER_MAX_CHARS = 12000  # longer chapters are split into parts (about 13 minutes each)
FORMAT = "1"  # bump to re-voice everything

try:
    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    gcp = AuthorizedSession(creds)
except google.auth.exceptions.DefaultCredentialsError:  # local testing only
    gcp = None
pool = ThreadPoolExecutor(6)
app = Flask(__name__)


# ---------------------------------------------------------------- bucket
def _obj_url(name: str) -> str:
    return f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o/{quote(name, safe='')}"


def get_bytes(name: str) -> bytes | None:
    r = gcp.get(_obj_url(name), params={"alt": "media"}, timeout=60)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.content


def get_json(name: str):
    b = get_bytes(name)
    return json.loads(b) if b is not None else None


def put(name: str, data: bytes, ctype: str) -> None:
    r = gcp.post(
        f"https://storage.googleapis.com/upload/storage/v1/b/{BUCKET}/o",
        params={"uploadType": "media", "name": name},
        data=data, headers={"Content-Type": ctype}, timeout=120,
    )
    r.raise_for_status()


def put_json(name: str, obj) -> None:
    put(name, json.dumps(obj).encode(), "application/json")


# ---------------------------------------------------------------- sessions
_secret = None
_secret_lock = threading.Lock()


def secret() -> bytes:
    global _secret
    with _secret_lock:
        if _secret is None:
            s = get_bytes("server/secret")
            if s is None:
                s = secrets.token_bytes(32)
                put("server/secret", s, "application/octet-stream")
            _secret = s
    return _secret


def make_session(email: str, days: int = 30) -> str:
    body = base64.urlsafe_b64encode(json.dumps({"e": email, "x": int(time.time()) + days * 86400}).encode()).decode()
    sig = hmac.new(secret(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def check_session(tok: str) -> str | None:
    try:
        body, sig = tok.rsplit(".", 1)
        if not hmac.compare_digest(sig, hmac.new(secret(), body.encode(), hashlib.sha256).hexdigest()):
            return None
        data = json.loads(base64.urlsafe_b64decode(body))
        if data["x"] < time.time() or data["e"] not in ALLOWED:
            return None
        return data["e"]
    except Exception:
        return None


_google_cache: dict[str, tuple[float, str]] = {}


def check_google(token: str) -> str:
    """Confirm a Google sign-in token is for this app and an allowed person."""
    hit = _google_cache.get(token)
    if hit and hit[0] > time.time():
        return hit[1]
    r = requests.get("https://oauth2.googleapis.com/tokeninfo", params={"access_token": token}, timeout=10)
    if r.status_code != 200:
        abort(401, "Your Google sign-in has expired. Sign in again.")
    info = r.json()
    if CLIENT_ID not in (info.get("azp"), info.get("aud")):
        abort(403, "Sign-in is for a different app.")
    email = info.get("email", "").lower()
    if email not in ALLOWED or str(info.get("email_verified")).lower() != "true":
        abort(403, "This Google account isn't allowed to use this reader.")
    _google_cache[token] = (time.time() + min(300, int(info.get("expires_in", 0))), email)
    return email


def require_session() -> str:
    h = request.headers.get("Authorization", "")
    email = check_session(h[7:]) if h.startswith("Bearer ") else None
    if not email:
        abort(401, "Please sign in again.")
    return email


def google_token() -> str:
    t = request.headers.get("X-Google-Token", "")
    if not t:
        abort(401, "Please sign in with Google to open documents.")
    check_google(t)
    return t


# ---------------------------------------------------------------- CORS
@app.before_request
def preflight():
    if request.method == "OPTIONS":
        return Response(status=204)


@app.after_request
def cors(resp):
    origin = request.headers.get("Origin")
    if origin in ORIGINS:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, X-Google-Token"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
        resp.headers["Access-Control-Expose-Headers"] = "Content-Length"
        resp.headers["Access-Control-Max-Age"] = "3600"
        resp.headers["Vary"] = "Origin"
    return resp


@app.errorhandler(Exception)
def errors(e):
    code = getattr(e, "code", 500)
    msg = getattr(e, "description", None) if code != 500 else None
    if code == 500:
        app.logger.exception(e)
        msg = "Something went wrong on the server. Try again in a moment."
    return jsonify(error=msg or str(e)), code


# ---------------------------------------------------------------- usage
_usage_lock = threading.Lock()


def month() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def add_usage(chars: int) -> None:
    with _usage_lock:
        name = f"usage/{month()}.json"
        u = get_json(name) or {"chars": 0}
        u["chars"] += chars
        put_json(name, u)


def usage() -> dict:
    u = get_json(f"usage/{month()}.json") or {"chars": 0}
    return {"month": month(), "chars": u["chars"], "free": FREE_CHARS_PER_MONTH}


# ---------------------------------------------------------------- voices
_voices = None


def voices() -> list[dict]:
    global _voices
    if _voices is None:
        r = gcp.get("https://texttospeech.googleapis.com/v1/voices", timeout=30)
        r.raise_for_status()
        accent = {"en-US": "American", "en-GB": "British", "en-AU": "Australian"}
        out = []
        for v in r.json().get("voices", []):
            name = v["name"]
            lang = v["languageCodes"][0]
            if "Chirp3-HD" in name and lang in LANGS:
                out.append({
                    "name": name,
                    "short": name.rsplit("-", 1)[-1],
                    "accent": accent[lang],
                    "gender": v.get("ssmlGender", "").lower().replace("neutral", ""),
                })
        out.sort(key=lambda v: (LANGS.index(next(k for k, a in accent.items() if a == v["accent"])), v["short"]))
        _voices = out
    return _voices


VOICE_RE = re.compile(r"^en-(US|GB|AU)-Chirp3-HD-[A-Za-z]+$")


def check_voice(v: str) -> str:
    if not VOICE_RE.match(v or ""):
        abort(400, "Unknown voice.")
    return v


def synth(text: str, voice: str) -> bytes:
    body = {
        "input": {"text": text},
        "voice": {"languageCode": voice[:5], "name": voice},
        "audioConfig": {"audioEncoding": "LINEAR16", "sampleRateHertz": SAMPLE_RATE},
    }
    for attempt in range(5):
        r = gcp.post("https://texttospeech.googleapis.com/v1/text:synthesize", json=body, timeout=180)
        if r.status_code == 200:
            break
        if r.status_code in (429, 500, 502, 503, 504) and attempt < 4:
            time.sleep(2 * 2 ** attempt)
            continue
        raise RuntimeError(f"Text-to-Speech error {r.status_code}: {r.text[:300]}")
    wav = base64.b64decode(r.json()["audioContent"])
    with wave.open(io.BytesIO(wav)) as w:
        if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (SAMPLE_RATE, 1, 2):
            raise RuntimeError("Unexpected audio format from Text-to-Speech")
        return w.readframes(w.getnframes())


def to_mp3(pcm: bytes) -> bytes:
    enc = lameenc.Encoder()
    enc.set_bit_rate(48)
    enc.set_in_sample_rate(SAMPLE_RATE)
    enc.set_channels(1)
    enc.set_quality(2)
    return bytes(enc.encode(pcm) + enc.flush())


# ---------------------------------------------------------------- documents
def doc_id_from(s: str) -> str:
    m = re.search(r"/d/([A-Za-z0-9_-]{20,})", s or "") or re.fullmatch(r"\s*([A-Za-z0-9_-]{20,})\s*", s or "")
    if not m:
        abort(400, "That doesn't look like a Google Doc link.")
    return m.group(1)


def fetch_doc(token: str, doc_id: str) -> tuple[dict, str]:
    h = {"Authorization": f"Bearer {token}"}
    r = requests.get(f"https://www.googleapis.com/drive/v3/files/{doc_id}", headers=h, timeout=30,
                     params={"fields": "id,name,mimeType,modifiedTime", "supportsAllDrives": "true"})
    if r.status_code in (403, 404):
        abort(404, "Can't open that document with your Google account. Check the link and that you can open it.")
    r.raise_for_status()
    meta = r.json()
    if meta["mimeType"] != "application/vnd.google-apps.document":
        abort(400, "That link isn't a Google Doc.")
    r = requests.get(f"https://www.googleapis.com/drive/v3/files/{doc_id}/export", headers=h, timeout=60,
                     params={"mimeType": "text/markdown"})
    r.raise_for_status()
    r.encoding = "utf-8"
    return meta, r.text


def _chapter_text(secs) -> str:
    return textprep.speakable_text(secs)


def chapterize(sections: list[textprep.Section]) -> list[dict]:
    """Group sections into chapters at the highest heading level that has at
    least two headings. Tiny chapters merge into the next; huge ones split."""
    levels = [s.level for s in sections if s.title]
    level = next((lv for lv in sorted(set(levels)) if levels.count(lv) >= 2), None)

    groups: list[dict] = []
    for s in sections:
        if level is not None and s.title and s.level <= level:
            groups.append({"title": s.title.rstrip("."), "secs": [s]})
        else:
            if not groups:
                groups.append({"title": "Introduction", "secs": []})
            groups[-1]["secs"].append(s)

    merged: list[dict] = []
    carry: list = []
    for g in groups:
        secs = carry + g["secs"]
        body = sum(len(p) for s in secs for p in s.paragraphs)
        if body < 300 and g is not groups[-1]:
            carry = secs  # e.g. a document title with no text under it
            continue
        merged.append({"title": g["title"], "secs": secs})
        carry = []

    out: list[dict] = []
    for g in merged:
        parts, cur, size = [], [], 0
        for s in g["secs"]:
            paras = list(s.paragraphs)
            head = s
            while True:
                piece = textprep.Section(title=head.title if head is not None else "", level=s.level)
                while paras and (size + len(paras[0]) <= CHAPTER_MAX_CHARS or not (cur or piece.paragraphs)):
                    size += len(paras[0])
                    piece.paragraphs.append(paras.pop(0))
                if piece.title or piece.paragraphs:
                    cur.append(piece)
                if not paras:
                    break
                parts.append(cur)
                cur, size, head = [], 0, None
        if cur:
            parts.append(cur)
        for i, p in enumerate(parts):
            title = g["title"] if len(parts) == 1 else f"{g['title']} (part {i + 1})"
            out.append({"title": title, "secs": p})
    return out


def build_doc(meta: dict, md: str) -> dict:
    sections = textprep.parse_markdown(md)
    if not sections:
        abort(400, "That document has no text to read.")
    chapters = []
    for n, g in enumerate(chapterize(sections)):
        chunks = textprep.make_chunks(g["secs"])
        blocks, spans = [], []
        for c in chunks:
            start = len(blocks)
            blocks += [{"k": k, "t": t.rstrip(".") if k == "h" else t} for k, t in c.items]
            spans.append([start, len(blocks), c.starts_section])
        text = _chapter_text(g["secs"])
        chapters.append({
            "n": n, "title": g["title"],
            "hash": hashlib.sha256((FORMAT + text).encode()).hexdigest()[:16],
            "chars": sum(len(c.text) for c in chunks),
            "blocks": blocks, "chunks": spans,
            "speak": [c.text for c in chunks],
        })
    return {"id": meta["id"], "title": meta["name"], "modified": meta["modifiedTime"], "chapters": chapters}


def public_doc(doc: dict) -> dict:
    return {**doc, "chapters": [{k: v for k, v in c.items() if k != "speak"} for c in doc["chapters"]]}


_lib_lock = threading.Lock()


def touch_library(doc: dict) -> None:
    with _lib_lock:
        lib = get_json("library.json") or {"docs": []}
        docs = [d for d in lib.get("docs", []) if d["id"] != doc["id"] and "opened" in d]
        docs.insert(0, {"id": doc["id"], "title": doc["title"], "chapters": len(doc["chapters"]),
                        "opened": datetime.now(timezone.utc).isoformat()})
        put_json("library.json", {"docs": docs[:50]})


# ---------------------------------------------------------------- voicing
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def voice_chapter(doc: dict, n: int, voice: str) -> dict:
    ch = doc["chapters"][n]
    base = f"chapters/{doc['id']}/{ch['hash']}-{voice}"
    with _locks_guard:
        lock = _locks.setdefault(base, threading.Lock())
    with lock:  # the page may ask for the same chapter twice (prefetch + play)
        meta = get_json(base + ".json")
        if meta:
            return meta
        pcms = list(pool.map(lambda t: synth(t, voice), ch["speak"]))
        audio = bytearray()
        starts: list[float] = [0.0] * len(ch["blocks"])
        for i, ((s, e, new_sec), pcm) in enumerate(zip(ch["chunks"], pcms)):
            if i:
                audio += b"\x00\x00" * int((1.2 if new_sec else 0.45) * SAMPLE_RATE)
            t0, dur = len(audio) / 2 / SAMPLE_RATE, len(pcm) / 2 / SAMPLE_RATE
            lens = [len(b["t"]) + 40 for b in ch["blocks"][s:e]]
            acc, total = 0, sum(lens)
            for j, ln in enumerate(lens):
                starts[s + j] = round(t0 + dur * acc / total, 2)
                acc += ln
            audio += pcm
        mp3 = to_mp3(bytes(audio))
        put(base + ".mp3", mp3, "audio/mpeg")
        meta = {"audio": base + ".mp3", "duration": round(len(audio) / 2 / SAMPLE_RATE, 1),
                "starts": starts, "voice": voice, "bytes": len(mp3)}
        put_json(base + ".json", meta)
        add_usage(ch["chars"])
        return meta


# ---------------------------------------------------------------- routes
@app.post("/api/session")
def api_session():
    email = check_google(request.headers.get("X-Google-Token", ""))
    return jsonify(session=make_session(email), email=email)


@app.get("/api/home")
def api_home():
    require_session()
    lib = get_json("library.json") or {"docs": []}
    docs = [d for d in lib.get("docs", []) if "opened" in d]  # skip entries from the first version
    return jsonify(docs=docs, usage=usage())


@app.get("/api/voices")
def api_voices():
    require_session()
    return jsonify(voices=voices())


@app.post("/api/doc")
def api_open():
    """Open (or re-read) a document from its link. Needs a fresh Google sign-in."""
    require_session()
    token = google_token()
    doc_id = doc_id_from((request.get_json(silent=True) or {}).get("url", ""))
    meta, md = fetch_doc(token, doc_id)
    doc = build_doc(meta, md)
    put_json(f"docs/{doc_id}.json", doc)
    touch_library(doc)
    return jsonify(public_doc(doc))


@app.get("/api/doc/<doc_id>")
def api_doc(doc_id):
    """The saved copy of a document (no Google sign-in needed)."""
    require_session()
    doc = get_json(f"docs/{doc_id_from(doc_id)}.json")
    if not doc:
        abort(404, "Open this document from its link first.")
    touch_library(doc)
    return jsonify(public_doc(doc))


@app.delete("/api/doc/<doc_id>")
def api_forget(doc_id):
    require_session()
    doc_id = doc_id_from(doc_id)
    with _lib_lock:
        lib = get_json("library.json") or {"docs": []}
        put_json("library.json", {"docs": [d for d in lib["docs"] if d["id"] != doc_id]})
    return jsonify(ok=True)


@app.post("/api/chapter")
def api_chapter():
    require_session()
    body = request.get_json(silent=True) or {}
    doc = get_json(f"docs/{doc_id_from(body.get('doc', ''))}.json")
    if not doc:
        abort(404, "Open this document from its link first.")
    n = int(body.get("n", -1))
    if not 0 <= n < len(doc["chapters"]):
        abort(400, "No such chapter.")
    if body.get("hash") and body["hash"] != doc["chapters"][n]["hash"]:
        abort(409, "This document changed. Go back and open it again.")
    return jsonify(voice_chapter(doc, n, check_voice(body.get("voice", ""))))


FILE_RE = re.compile(r"^chapters/[A-Za-z0-9_-]{20,}/[0-9a-f]{16}-en-(US|GB|AU)-Chirp3-HD-[A-Za-z]+\.mp3$")


@app.get("/api/file")
def api_file():
    require_session()
    path = request.args.get("path", "")
    if not FILE_RE.match(path):
        abort(400, "Bad file name.")
    data = get_bytes(path)
    if data is None:
        abort(404, "Audio not found.")
    return Response(data, mimetype="audio/mpeg", headers={"Cache-Control": "private, max-age=31536000"})


@app.get("/api/sample")
def api_sample():
    require_session()
    voice = check_voice(request.args.get("voice", ""))
    name = f"samples/{voice}.mp3"
    data = get_bytes(name)
    if data is None:
        data = to_mp3(synth(SAMPLE_TEXT, voice))
        put(name, data, "audio/mpeg")
        add_usage(len(SAMPLE_TEXT))
    return Response(data, mimetype="audio/mpeg", headers={"Cache-Control": "private, max-age=31536000"})


@app.get("/")
def health():
    return "Listening server is running."
