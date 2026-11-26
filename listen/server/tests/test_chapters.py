import os, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.update(BUCKET="t", CLIENT_ID="c", ALLOWED_EMAILS="me@example.com")
import main, textprep  # noqa: E402


def chapters(md):
    return main.chapterize(textprep.parse_markdown(md))


class ChapterTest(unittest.TestCase):
    def test_title_then_h2_chapters(self):
        md = "# Course\n\nIntro text " + "x" * 400 + "\n\n## One\n\n" + "a " * 300 + "\n\n## Two\n\n" + "b " * 300
        self.assertEqual([c["title"] for c in chapters(md)], ["Course", "One", "Two"])

    def test_empty_title_merges_forward(self):
        md = "# Plan\n\n## A Deep Study\n\nShort intro " + "y" * 400 + "\n\n## Part One\n\n" + "a " * 300 + "\n\n## Part Two\n\n" + "b " * 300
        self.assertEqual([c["title"] for c in chapters(md)], ["A Deep Study", "Part One", "Part Two"])

    def test_no_headings_splits_by_size(self):
        md = "\n\n".join(["Paragraph %d. " % i + "word " * 200 for i in range(40)])
        ch = chapters(md)
        self.assertGreater(len(ch), 2)
        self.assertTrue(all(sum(len(p) for s in c["secs"] for p in s.paragraphs) <= main.CHAPTER_MAX_CHARS for c in ch))
        self.assertTrue(ch[1]["title"].endswith("(part 2)"))

    def test_session_roundtrip(self):
        main.secret = lambda: b"k" * 32
        tok = main.make_session("me@example.com")
        self.assertEqual(main.check_session(tok), "me@example.com")
        self.assertIsNone(main.check_session(tok[:-2] + "00"))
        self.assertIsNone(main.check_session(main.make_session("other@example.com")))


if __name__ == "__main__":
    unittest.main()
