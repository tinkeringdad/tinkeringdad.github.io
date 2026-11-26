"""Turn a Google Doc (exported as Markdown) into clean, speakable text.

What this does, in plain terms:
  * removes Markdown symbols (#, *, _, `, >, |), links, images and code blocks
    so they are never read aloud
  * keeps headings as their own lines, so the reader pauses before and after
  * groups the text into sections (one per heading) and paragraphs
  * splits each section into chunks that fit under the TTS size limit

Only the Python standard library is used.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Gemini-TTS accepts up to ~4,000 bytes of text per request. Staying well
# under that keeps each request short and leaves room for non-ASCII text.
MAX_CHUNK_BYTES = 3000


@dataclass
class Section:
    title: str  # "" for text that comes before the first heading
    paragraphs: list[str] = field(default_factory=list)
    level: int = 0  # 1 for "#", 2 for "##" ... ; 0 for text before any heading


# ---------------------------------------------------------------------------
# Inline cleanup (one line or paragraph at a time)
# ---------------------------------------------------------------------------

_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)")
_REF_LINK = re.compile(r"\[([^\]]+)\]\[[^\]]*\]")
_FOOTNOTE = re.compile(r"\[\^[^\]]+\]")
_BARE_URL = re.compile(r"(?:https?://|www\.)\S+")
_HTML_TAG = re.compile(r"</?[A-Za-z][^>]*>")
_INLINE_CODE = re.compile(r"`+([^`]*)`+")
_BOLD_ITALIC = re.compile(r"(\*{1,3}|_{1,3})(?=\S)(.+?)(?<=\S)\1")
_STRIKE = re.compile(r"~~(.+?)~~")
_ESCAPE = re.compile(r"\\([\\`*_{}\[\]()#+\-.!|>~<=\"'$&%^:;,/?@])")


def clean_inline(text: str) -> str:
    text = _IMAGE.sub("", text)
    text = _LINK.sub(r"\1", text)
    text = _REF_LINK.sub(r"\1", text)
    text = _FOOTNOTE.sub("", text)
    text = _HTML_TAG.sub("", text)
    text = _BARE_URL.sub("the link", text)
    text = _INLINE_CODE.sub(r"\1", text)
    text = _STRIKE.sub(r"\1", text)
    # Run twice so nested emphasis like ***bold italic*** or **_x_** unwraps.
    for _ in range(2):
        text = _BOLD_ITALIC.sub(r"\2", text)
    text = _ESCAPE.sub(r"\1", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    text = text.replace(" ", " ")
    text = re.sub(r"[ \t]+", " ", text)
    # Space left before punctuation by removed links etc.
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"\(\s*\)", "", text)
    return text.strip()


def _end_with_stop(text: str) -> str:
    """Headings and list items often lack a full stop; add one so the voice
    pauses instead of running straight into the next line."""
    if text and text[-1] not in ".!?:;…\"'”’)":
        return text + "."
    return text


# ---------------------------------------------------------------------------
# Block-level parsing
# ---------------------------------------------------------------------------

_HEADING = re.compile(r"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
_SETEXT = re.compile(r"^\s{0,3}(=+|-+)\s*$")
_HRULE = re.compile(r"^\s{0,3}([-*_])(\s*\1){2,}\s*$")
_FENCE = re.compile(r"^\s{0,3}(```|~~~)")
_LIST = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?")
_QUOTE = re.compile(r"^\s*>\s?")
_TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")


def parse_markdown(md: str) -> list[Section]:
    """Return the document as a list of sections of clean paragraphs."""
    lines = md.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    sections: list[Section] = [Section(title="")]
    buf: list[str] = []
    in_fence = False
    in_html_comment = False

    def flush() -> None:
        if buf:
            para = clean_inline(" ".join(buf))
            if para and re.search(r"[A-Za-z0-9]", para):
                sections[-1].paragraphs.append(para)
            buf.clear()

    for i, raw in enumerate(lines):
        line = raw.rstrip()

        if in_html_comment:
            if "-->" in line:
                in_html_comment = False
            continue
        if line.lstrip().startswith("<!--"):
            if "-->" not in line:
                in_html_comment = True
            continue

        if _FENCE.match(line):
            flush()
            in_fence = not in_fence
            continue
        if in_fence:
            continue  # code blocks are never read aloud
        if line.startswith("    ") and not buf and line.strip():
            continue  # indented code block

        if not line.strip():
            flush()
            continue

        m = _HEADING.match(line)
        if m:
            flush()
            title = clean_inline(m.group(2))
            if title:
                sections.append(Section(title=title, level=len(m.group(1))))
            continue

        # "Title\n=====" style headings
        if buf and _SETEXT.match(line):
            title = clean_inline(" ".join(buf))
            level = 1 if line.strip().startswith("=") else 2
            buf.clear()
            if title:
                sections.append(Section(title=title, level=level))
            continue

        if _HRULE.match(line):
            flush()
            continue

        if _TABLE_SEP.match(line):
            continue
        if line.lstrip().startswith("|"):
            flush()
            cells = [clean_inline(c) for c in line.strip().strip("|").split("|")]
            cells = [c for c in cells if c]
            if cells:
                buf.append(_end_with_stop(", ".join(cells)))
                flush()
            continue

        line = _QUOTE.sub("", line)
        if _LIST.match(line):
            flush()
            buf.append(_end_with_stop(clean_inline(_LIST.sub("", line))))
            # list items are their own paragraphs unless continued below
            nxt = lines[i + 1] if i + 1 < len(lines) else ""
            if not nxt.startswith(("  ", "\t")) or _LIST.match(nxt):
                flush()
            continue

        buf.append(line.strip())

    flush()

    out = []
    for s in sections:
        if s.title or s.paragraphs:
            s.title = _end_with_stop(s.title) if s.title else ""
            out.append(s)
    return out


# ---------------------------------------------------------------------------
# Chunking for the TTS request size limit
# ---------------------------------------------------------------------------

def _nbytes(s: str) -> int:
    return len(s.encode("utf-8"))


def _split_long(text: str, limit: int) -> list[str]:
    """Split one over-long paragraph at sentence, then word, boundaries."""
    sentences = re.split(r"(?<=[.!?…])\s+", text)
    pieces: list[str] = []
    cur = ""
    for sent in sentences:
        while _nbytes(sent) > limit:  # a single giant sentence: cut by words
            words, part = sent.split(" "), ""
            for w in words:
                if _nbytes(part + " " + w) > limit and part:
                    break
                part = (part + " " + w).strip()
            pieces.append(part)
            sent = sent[len(part):].strip()
        cand = (cur + " " + sent).strip()
        if _nbytes(cand) > limit and cur:
            pieces.append(cur)
            cur = sent
        else:
            cur = cand
    if cur:
        pieces.append(cur)
    return pieces


@dataclass
class Chunk:
    section: int  # index into the sections list
    items: list[tuple[str, str]]  # (kind, text), kind is "h" or "p"
    starts_section: bool

    @property
    def text(self) -> str:
        return "\n\n".join(t for _, t in self.items)


def make_chunks(sections: list[Section], limit: int = MAX_CHUNK_BYTES) -> list[Chunk]:
    """Group paragraphs into TTS-sized chunks. A chunk never spans two
    sections, so every section starts at an exact, known time in the audio."""
    chunks: list[Chunk] = []
    for si, sec in enumerate(sections):
        items: list[tuple[str, str]] = [("h", sec.title)] if sec.title else []
        for p in sec.paragraphs:
            for piece in _split_long(p, limit) if _nbytes(p) > limit else [p]:
                items.append(("p", piece))

        cur: list[tuple[str, str]] = []
        first = True
        for kind, text in items:
            joined = "\n\n".join(t for _, t in cur + [(kind, text)])
            if cur and _nbytes(joined) > limit:
                chunks.append(Chunk(si, cur, first))
                cur, first = [], False
            cur.append((kind, text))
        if cur:
            chunks.append(Chunk(si, cur, first))
    return chunks


def speakable_text(sections: list[Section]) -> str:
    """The full cleaned text, used to detect whether a document changed."""
    parts = []
    for s in sections:
        if s.title:
            parts.append("# " + s.title)
        parts.extend(s.paragraphs)
    return "\n\n".join(parts)
