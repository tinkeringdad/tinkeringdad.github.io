"""Run the server locally with stand-ins for Google (for testing only).

    python tests/devserver.py DOCS_FOLDER   ->  http://localhost:8080

Documents are .md files in DOCS_FOLDER; "links" are their file names padded
to look like Doc IDs. The voice is espeak-ng. Storage is in memory.
"""
import os, subprocess, sys, io, wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
os.environ.update(BUCKET="test", CLIENT_ID="test-client", ALLOWED_EMAILS="me@example.com")
import main  # noqa: E402

DOCS = Path(sys.argv[1])
store: dict[str, bytes] = {}
main.get_bytes = lambda name: store.get(name)
main.put = lambda name, data, ctype: store.__setitem__(name, data)
main.check_google = lambda token: "me@example.com" if token == "good" else main.abort(401, "bad token")


def fake_synth(text, voice):
    wav = subprocess.run(["espeak-ng", "-v", "en-us", "-s", "175", "--stdout", text], capture_output=True, check=True).stdout
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", "24000", "pipe:1"],
                         input=wav, capture_output=True, check=True).stdout
    return pcm


main.synth = fake_synth
main.voices = lambda: [
    {"name": "en-GB-Chirp3-HD-Iapetus", "short": "Iapetus", "accent": "British", "gender": "male"},
    {"name": "en-US-Chirp3-HD-Charon", "short": "Charon", "accent": "American", "gender": "male"},
    {"name": "en-US-Chirp3-HD-Kore", "short": "Kore", "accent": "American", "gender": "female"},
]


def fake_fetch(token, doc_id):
    for p in DOCS.glob("*.md"):
        if doc_id.startswith(p.stem.replace(" ", "")[:10]):
            return {"id": doc_id, "name": p.stem, "modifiedTime": "2026-11-26T00:00:00Z"}, p.read_text()
    main.abort(404, "Can't open that document with your Google account.")


main.fetch_doc = fake_fetch
main.ORIGINS.add("http://localhost:8000")

if __name__ == "__main__":
    for p in DOCS.glob("*.md"):
        print("link:", "https://docs.google.com/document/d/" + (p.stem.replace(" ", "")[:10] + "x" * 30)[:40] + "/edit")
    main.app.run(port=8080, threaded=True)
