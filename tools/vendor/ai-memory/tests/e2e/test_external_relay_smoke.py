"""Run with: python -m unittest discover -s tests/e2e -p 'test_*.py'."""

import argparse
import json
import sys
import tempfile
import unittest
from pathlib import Path

from external_relay_smoke import Harness, SmokeFailure, subprocess_diagnostics


class SubprocessDiagnosticsTest(unittest.TestCase):
    def test_failed_subprocess_exposes_safe_error_markers_not_payloads(self):
        with tempfile.TemporaryDirectory() as parent:
            harness = Harness(argparse.Namespace(artifacts_parent=Path(parent), timeout_seconds=10))
            secret = "private-test-credential"
            stderr = (
                "error: configure relay queue at C:\\private\\user\\relay.sqlite: database is locked\n"
                "Authorization: Bearer " + secret + "\n"
                'payload={"prompt":"confidential message"}\n'
                "\x1b[31mHTTP 503 from /hook/batch: response private-body\x1b[0m\n"
                "private filename (os error 32)\n"
            )
            script = "import sys; sys.stdout.write('private stdout'); sys.stderr.write(" + repr(stderr) + "); sys.exit(2)"
            with self.assertRaises(SmokeFailure) as raised:
                harness.run(Path(sys.executable), ["-c", script], token=secret, label="flush-concurrent-03")
            message = str(raised.exception)
            self.assertIn("flush-concurrent-03 exited 2, expected 0", message)
            self.assertIn("configure relay queue", message)
            self.assertIn("database is locked", message)
            self.assertIn("HTTP 503", message)
            self.assertIn("os error 32", message)
            for sensitive in [secret, "private", "confidential", "payload", "Authorization", "\x1b"]:
                self.assertNotIn(sensitive, message)
            self.assertLessEqual(len(message), 1024)
            # Diagnostic presentation must not alter the existing captured evidence.
            log = json.loads(next(harness.logs.glob("command-*.json")).read_text())
            self.assertEqual(log["stderr"], stderr)
            self.assertEqual(log["returncode"], 2)

    def test_unknown_and_large_output_are_omitted_and_success_is_unchanged(self):
        with tempfile.TemporaryDirectory() as parent:
            harness = Harness(argparse.Namespace(artifacts_parent=Path(parent), timeout_seconds=10))
            script = "import sys; sys.stderr.write('sensitive unknown content ' * 10000); sys.exit(2)"
            with self.assertRaises(SmokeFailure) as raised:
                harness.run(Path(sys.executable), ["-c", script], label="unknown")
            self.assertIn("unrecognized stderr omitted", str(raised.exception))
            self.assertNotIn("sensitive", str(raised.exception))
            self.assertLessEqual(len(str(raised.exception)), 1024)
            result = harness.run(Path(sys.executable), ["-c", "print('ok')"], label="success")
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout.strip(), "ok")

    def test_expected_failure_and_unspecified_exit_do_not_raise(self):
        with tempfile.TemporaryDirectory() as parent:
            harness = Harness(argparse.Namespace(artifacts_parent=Path(parent), timeout_seconds=10))
            for expected in [2, None]:
                result = harness.run(Path(sys.executable), ["-c", "raise SystemExit(2)"], label="expected", expect=expected)
                self.assertEqual(result.returncode, 2)

    def test_numeric_codes_are_bounded_and_empty_stderr_is_explicit(self):
        self.assertEqual(subprocess_diagnostics(""), "stderr empty")
        stderr = "\n".join(f"HTTP {code} from /hook/batch" for code in range(100, 600))
        message = subprocess_diagnostics(stderr)
        self.assertIn("HTTP 100", message)
        self.assertEqual(message.count("HTTP "), 4)
        self.assertLessEqual(len(message), 1024)
        self.assertEqual(
            subprocess_diagnostics("(os error private-token) HTTP 999 from /hook/batch"),
            "unrecognized stderr omitted",
        )


if __name__ == "__main__":
    unittest.main()
