from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage

from dotenv import load_dotenv
from fastmcp import FastMCP

load_dotenv()

mcp = FastMCP("Gmail Share Server")


def _smtp_settings() -> tuple[str, int, str, str, str]:
    host = os.getenv("GMAIL_SMTP_HOST", "smtp.gmail.com").strip()
    port = int(os.getenv("GMAIL_SMTP_PORT", "587"))
    username = os.getenv("GMAIL_USERNAME", "").strip()
    password = os.getenv("GMAIL_APP_PASSWORD", "").strip()
    sender = os.getenv("GMAIL_FROM", "").strip() or username
    if not username or not password:
        raise RuntimeError(
            "GMAIL_USERNAME and GMAIL_APP_PASSWORD must be set to send mail."
        )
    if not sender:
        sender = username
    return host, port, username, password, sender


@mcp.tool
def send_email(
    to: str | None = None,
    subject: str = "",
    body: str = "",
    html_body: str | None = None,
    output_slug: str | None = None,
) -> dict:
    """
    Send the blog content as an email.

    The recipient can come from the tool call or from GMAIL_TO in .env.
    """
    host, port, username, password, sender = _smtp_settings()
    recipient = (to or os.getenv("GMAIL_TO", "")).strip()
    if not recipient:
        raise RuntimeError("No recipient provided. Pass `to` or set GMAIL_TO.")
    if not subject.strip():
        raise RuntimeError("Subject is required.")
    if not body.strip():
        raise RuntimeError("Body is required.")

    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = subject
    if output_slug:
        message["X-Output-Slug"] = output_slug
    message.set_content(body)
    if html_body and html_body.strip():
        message.add_alternative(html_body, subtype="html")

    with smtplib.SMTP(host, port, timeout=30) as smtp:
        smtp.ehlo()
        if port == 587:
            smtp.starttls()
            smtp.ehlo()
        smtp.login(username, password)
        smtp.send_message(message)

    return {
        "ok": True,
        "to": recipient,
        "subject": subject,
        "output_slug": output_slug,
        "message": "Email sent successfully.",
    }


if __name__ == "__main__":
    mcp.run()
