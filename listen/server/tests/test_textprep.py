import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import textprep  # noqa: E402

SAMPLE = (Path(__file__).parent / "sample.md").read_text()


class TextPrepTest(unittest.TestCase):
    def setUp(self):
        self.sections = textprep.parse_markdown(SAMPLE)
        self.text = textprep.speakable_text(self.sections)

    def test_sections_from_headings(self):
        titles = [s.title for s in self.sections]
        self.assertEqual(titles, ["How Bridges Stand Up.", "Part One. Loads.", "Part Two. Why Arches Work."])

    def test_markdown_symbols_removed(self):
        body = self.text.replace("# ", "")
        for bad in ("**", "](", "http", "```", "|", "[^", "<b>", "-----", "\\", "print("):
            self.assertNotIn(bad, body, bad)

    def test_content_kept(self):
        for good in ("Federal Highway Administration", "dead load", "Environmental load, such as wind.",
                     "Beam, 250 feet.", "Engineers say a bridge is a load path", "the museum", "End of course."):
            self.assertIn(good, self.text, good)

    def test_chunks_respect_limit_and_sections(self):
        long_md = "# A\n\n" + ("This is a sentence that goes on. " * 400) + "\n\n# B\n\nShort."
        chunks = textprep.make_chunks(textprep.parse_markdown(long_md), limit=1000)
        self.assertTrue(all(len(c.text.encode()) <= 1000 for c in chunks))
        self.assertEqual(sum(c.starts_section for c in chunks), 2)
        self.assertEqual(len({c.section for c in chunks}), 2)


if __name__ == "__main__":
    unittest.main()
