from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from dotenv import load_dotenv
from fastmcp import FastMCP

load_dotenv()

mcp = FastMCP("Slack Share Server")


def _post_webhook(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read().decode("utf-8", errors="replace")
        return {"status": response.status, "body": body}


def _post_chat_message(token: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        data=data,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read().decode("utf-8", errors="replace")
        return json.loads(body)


@mcp.tool
def post_message(
    text: str,
    channel: str | None = None,
    title: str | None = None,
    output_slug: str | None = None,
    blocks: list[dict] | None = None,
) -> dict:
    """
    Post the generated blog to Slack.

    Uses SLACK_WEBHOOK_URL if available, otherwise falls back to Slack Web API
    with SLACK_BOT_TOKEN + channel.
    """
    channel_name = (channel or os.getenv("SLACK_CHANNEL", "") or os.getenv("SLACK_DEFAULT_CHANNEL", "")).strip()
    if not text.strip():
        raise RuntimeError("Message text is required.")
    title_text = title or "Agentic Blog"
    header = f"*{title_text}*"
    if output_slug:
        header = f"{header} (`{output_slug}`)"
    message_text = f"{header}\n\n{text}"
    payload = {"text": message_text}
    if blocks:
        payload["blocks"] = blocks

    webhook_url = os.getenv("SLACK_WEBHOOK_URL", "").strip()
    if webhook_url:
        try:
            result = _post_webhook(webhook_url, payload)
            return {
                "ok": True,
                "mode": "webhook",
                "channel": channel_name or None,
                "output_slug": output_slug,
                "result": result,
            }
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Slack webhook request failed: {exc}") from exc

    bot_token = os.getenv("SLACK_BOT_TOKEN", "").strip()
    if bot_token and channel_name:
        try:
            payload["channel"] = channel_name
            result = _post_chat_message(bot_token, payload)
            return {
                "ok": bool(result.get("ok")),
                "mode": "bot_token",
                "channel": channel_name,
                "output_slug": output_slug,
                "result": result,
            }
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Slack API request failed: {exc}") from exc

    raise RuntimeError(
        "Configure SLACK_WEBHOOK_URL or SLACK_BOT_TOKEN + SLACK_CHANNEL/SLACK_DEFAULT_CHANNEL."
    )


if __name__ == "__main__":
    mcp.run()
