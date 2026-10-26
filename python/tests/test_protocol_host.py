"""Pinned callback diagnostics cannot corrupt the native JSONL channel."""
from contextlib import redirect_stderr
from io import BytesIO, StringIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.__main__ import run
from contest_host.host import Host


class ProtocolHostTests(unittest.TestCase):
    def test_plugin_stdout_diagnostics_are_stderr_only(self):
        class NoisyHost(Host):
            def dispatch(self, request):
                print("result={}")
                return super().dispatch(request)

        with TemporaryDirectory() as temporary:
            host = NoisyHost(Path(temporary).resolve())
            try:
                output, diagnostics = BytesIO(), StringIO()
                with redirect_stderr(diagnostics):
                    code = run(BytesIO(b'{"id":"catalog","method":"catalog","params":{}}\n'), output, host)
                self.assertEqual(code, 0)
                frames = output.getvalue().decode().splitlines()
                self.assertEqual(len(frames), 1)
                self.assertTrue(json.loads(frames[0])["ok"])
                self.assertIn("result={}", diagnostics.getvalue())
            finally:
                host.close()


if __name__ == "__main__":
    unittest.main()
