#!/usr/bin/env python3
"""Loopback OpenAI-compatible Codex fallback bridge.

Runs the already-authenticated local Codex CLI in read-only mode. It accepts
only structured chat requests from the Arra adapter and never exposes the
Codex login or arbitrary shell access through HTTP.
"""

from __future__ import annotations

import hmac
import json
import os
import secrets
import shutil
import subprocess
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

MAX_REQUEST_BYTES = 180_000
DEFAULT_MODEL = "codex"


def env_value(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def json_response(handler: BaseHTTPRequestHandler, body: Any, status: int = 200) -> None:
    encoded = json.dumps(body, separators=(",", ":")).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json")
    handler.send_header("cache-control", "no-store")
    handler.send_header("content-length", str(len(encoded)))
    handler.end_headers()
    handler.wfile.write(encoded)


def authorized(handler: BaseHTTPRequestHandler) -> bool:
    expected = env_value("CODEX_BRIDGE_KEY")
    supplied = handler.headers.get("authorization", "")
    if supplied.lower().startswith("bearer "):
        supplied = supplied[7:].strip()
    if not expected or not hmac.compare_digest(supplied, expected):
        json_response(handler, {"error": {"message": "Invalid API key", "type": "invalid_request_error", "code": "invalid_api_key"}}, 401)
        return False
    return True


def content_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(content_text(item.get("text", item.get("content", "")) if isinstance(item, dict) else item) for item in value)
    return json.dumps(value if value is not None else "", ensure_ascii=False)


def build_prompt(messages: list[dict[str, Any]]) -> str:
    conversation = "\n\n".join(f"{str(message.get('role', 'user')).upper()}: {content_text(message.get('content', ''))}" for message in messages)
    return "\n\n".join([
        "You are a private fallback inference engine for Arra.",
        "Use only the supplied conversation text. Do not use tools, filesystem, MCP, web search, or network calls.",
        "Return exactly one JSON object satisfying the requested Arra contract. Do not wrap it in Markdown.",
        conversation,
    ])


def is_consolidation(prompt: str) -> bool:
    upper = prompt.upper()
    return "SUPERSEDE" in upper or "NOOP" in upper


def parse_output(raw: str) -> str:
    text = raw.strip()
    if not text:
        return ""
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            candidate = event_text(parsed)
            if candidate:
                return candidate
        return parsed if isinstance(parsed, str) else json.dumps(parsed, separators=(",", ":"))
    except json.JSONDecodeError:
        for line in reversed(text.splitlines()):
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            candidate = event_text(event)
            if candidate:
                return candidate
        return text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()


def event_text(event: Any) -> str:
    item = event.get("item") if isinstance(event, dict) else None
    content = item.get("content") if isinstance(item, dict) else None
    if isinstance(content, list):
        for part in content:
            if isinstance(part, dict) and isinstance(part.get("text"), str) and part["text"].strip():
                return part["text"].strip()
    return ""


def codex_args(output_path: Path, consolidation: bool) -> list[str]:
    root = Path(__file__).resolve().parent
    schema = root / ("codex-consolidation.schema.json" if consolidation else "codex-ask.schema.json")
    workdir = Path(env_value("CODEX_WORKDIR", str(Path(tempfile.gettempdir()) / "arra-codex-work")))
    workdir.mkdir(mode=0o700, parents=True, exist_ok=True)
    args = [
        "-C", str(workdir),
        "-c", "mcp_servers={}",
        "-c", "plugins={}",
        "--sandbox", "read-only",
        "--ask-for-approval", "never",
    ]
    model = env_value("CODEX_MODEL")
    if model and model.lower() != DEFAULT_MODEL:
        args.extend(["--model", model])
    args.extend([
        "exec", "--ephemeral", "--json", "--skip-git-repo-check",
        "--output-schema", str(schema),
        "--output-last-message", str(output_path),
        "-",
    ])
    return args


def run_codex(prompt: str, output_path: Path, consolidation: bool) -> tuple[int, str, str]:
    command = env_value("CODEX_BIN", "codex")
    args = [command, *codex_args(output_path, consolidation)]
    child_env = os.environ.copy()
    timeout = float(env_value("CODEX_TIMEOUT_SECONDS", "90"))
    try:
        completed = subprocess.run(
            args,
            input=prompt,
            text=True,
            capture_output=True,
            cwd=env_value("CODEX_WORKDIR", str(Path(tempfile.gettempdir()) / "arra-codex-work")),
            env=child_env,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 1, "", str(exc)
    output = ""
    try:
        output = output_path.read_text(encoding="utf-8")
    except OSError:
        pass
    return completed.returncode, output or completed.stdout, completed.stderr


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "ArraCodexBridge/1"

    def log_message(self, _format: str, *_args: Any) -> None:
        # Never log prompts, sources, output, or authorization headers.
        return

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/health":
            json_response(self, {
                "status": "ok",
                "provider": "codex",
                "model": env_value("CODEX_MODEL", DEFAULT_MODEL),
                "configured": bool(env_value("CODEX_BRIDGE_KEY")) and bool(shutil.which(env_value("CODEX_BIN", "codex"))),
            })
            return
        if path == "/v1/models":
            if not authorized(self):
                return
            model = env_value("CODEX_MODEL", DEFAULT_MODEL)
            json_response(self, {"object": "list", "data": [{"id": model, "object": "model", "owned_by": "codex-bridge"}]})
            return
        json_response(self, {"error": {"message": "not_found", "type": "invalid_request_error"}}, 404)

    def do_POST(self) -> None:  # noqa: N802
        if urlparse(self.path).path != "/v1/chat/completions":
            json_response(self, {"error": {"message": "not_found", "type": "invalid_request_error"}}, 404)
            return
        if not authorized(self):
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            if length <= 0 or length > MAX_REQUEST_BYTES:
                raise ValueError("request size out of bounds")
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError("request must be an object")
            messages = [item for item in body.get("messages", []) if isinstance(item, dict)]
            if not messages:
                raise ValueError("messages are required")
            prompt = build_prompt(messages)
            if len(prompt) > MAX_REQUEST_BYTES:
                raise ValueError("prompt size out of bounds")
        except (ValueError, json.JSONDecodeError, TypeError):
            json_response(self, {"error": {"message": "invalid request", "type": "invalid_request_error"}}, 400)
            return

        temp_parent = Path(env_value("CODEX_BRIDGE_TMPDIR", tempfile.gettempdir()))
        temp_parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        request_root = Path(tempfile.mkdtemp(prefix="arra-codex-", dir=temp_parent))
        output_path = request_root / "last-message.json"
        try:
            code, output, _stderr = run_codex(prompt, output_path, is_consolidation(prompt))
            if code != 0:
                json_response(self, {"error": {"message": "Codex fallback failed", "type": "server_error", "code": "codex_bridge_failed"}}, 502)
                return
            structured = parse_output(output)
            if not structured:
                json_response(self, {"error": {"message": "Codex fallback returned no structured output", "type": "server_error", "code": "codex_bridge_empty"}}, 502)
                return
            json_response(self, {
                "id": f"chatcmpl-codex-{secrets.token_hex(12)}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": env_value("CODEX_MODEL", DEFAULT_MODEL),
                "choices": [{"index": 0, "message": {"role": "assistant", "content": structured}, "finish_reason": "stop"}],
            })
        finally:
            shutil.rmtree(request_root, ignore_errors=True)


def main() -> None:
    port = int(env_value("CODEX_BRIDGE_PORT", "47781"))
    server = ThreadingHTTPServer(("127.0.0.1", port), BridgeHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
