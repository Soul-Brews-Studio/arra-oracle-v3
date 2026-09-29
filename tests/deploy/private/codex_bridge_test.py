import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3] / "deploy" / "private" / "arra-full-stack" / "codex-bridge.py"
SPEC = importlib.util.spec_from_file_location("arra_codex_bridge", ROOT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class CodexBridgeTest(unittest.TestCase):
    def test_prompt_forbids_tools_and_preserves_sources(self):
        prompt = MODULE.build_prompt([
            {"role": "system", "content": "Return JSON"},
            {"role": "user", "content": "question=Arra; source=doc-1"},
        ])
        self.assertIn("Do not use tools", prompt)
        self.assertIn("source=doc-1", prompt)

    def test_parses_structured_last_message_and_jsonl_fallback(self):
        self.assertEqual(MODULE.parse_output('{"answer":"ok"}'), '{"answer":"ok"}')
        self.assertEqual(MODULE.parse_output('{"item":{"content":[{"text":"{\\"answer\\":\\"ok\\"}"}]}}'), '{"answer":"ok"}')

    def test_codex_args_are_read_only_and_mcp_free(self):
        args = MODULE.codex_args(Path('/tmp/arra-last-message.json'), False)
        self.assertIn("mcp_servers={}", args)
        self.assertIn("plugins={}", args)
        self.assertIn("read-only", args)
        self.assertIn("never", args)
        self.assertIn("--output-schema", args)
        self.assertLess(args.index("--ask-for-approval"), args.index("exec"))
        self.assertLess(args.index("--sandbox"), args.index("exec"))
        self.assertLess(args.index("exec"), args.index("--ephemeral"))

    def test_pinned_model_is_a_global_option(self):
        old = MODULE.env_value
        try:
            MODULE.env_value = lambda name, default="": "gpt-test" if name == "CODEX_MODEL" else old(name, default)
            args = MODULE.codex_args(Path('/tmp/arra-last-message.json'), False)
            self.assertLess(args.index("--model"), args.index("exec"))
        finally:
            MODULE.env_value = old


if __name__ == "__main__":
    unittest.main()
