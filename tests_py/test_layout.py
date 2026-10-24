import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class LayoutTest(unittest.TestCase):
    def test_plugin_manifest_parses_and_names_temper(self):
        manifest = json.loads((ROOT / '.claude-plugin' / 'plugin.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest['name'], 'temper')


if __name__ == '__main__':
    unittest.main()
