from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

ROOT_DIR = Path(__file__).resolve().parents[1]
DB_PATH = ROOT_DIR / "blog_agent.db"
OUTPUTS_DIR = ROOT_DIR / "outputs"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db() -> None:
    OUTPUTS_DIR.mkdir(exist_ok=True)
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS blogs (
                output_slug TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                topic TEXT,
                audience TEXT,
                tone TEXT,
                blog_length TEXT,
                as_of TEXT,
                mode TEXT,
                recency_days INTEGER,
                generate_images INTEGER DEFAULT 1,
                max_images INTEGER DEFAULT 3,
                final_md TEXT NOT NULL,
                plan_json TEXT,
                evidence_json TEXT,
                sections_json TEXT,
                image_specs_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_blogs_updated_at ON blogs(updated_at DESC)")


def _json_dumps(value: Any) -> Optional[str]:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False)


def _json_loads(value: Optional[str], default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except Exception:
        return default


def blog_exists(output_slug: str) -> bool:
    init_db()
    with _connect() as conn:
        row = conn.execute("SELECT 1 FROM blogs WHERE output_slug = ?", (output_slug,)).fetchone()
    return row is not None


def allocate_output_slug(base_title: str) -> str:
    from re import sub

    def safe_slug(title: str) -> str:
        s = title.strip().lower()
        s = sub(r"[^a-z0-9 _-]+", "", s)
        s = sub(r"\s+", "_", s).strip("_")
        return s or "blog"

    base = safe_slug(base_title)
    if not blog_exists(base) and not (OUTPUTS_DIR / base).exists():
        return base

    for idx in range(2, 1000):
        candidate = f"{base}_{idx}"
        if not blog_exists(candidate) and not (OUTPUTS_DIR / candidate).exists():
            return candidate

    return f"{base}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"


def upsert_blog(record: Dict[str, Any]) -> None:
    init_db()
    payload = dict(record)
    now = _now_iso()
    existing_created_at = None
    with _connect() as conn:
        row = conn.execute("SELECT created_at FROM blogs WHERE output_slug = ?", (payload["output_slug"],)).fetchone()
        if row:
            existing_created_at = row["created_at"]
    payload.setdefault("created_at", existing_created_at or now)
    payload["updated_at"] = now
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO blogs (
                output_slug, title, topic, audience, tone, blog_length, as_of, mode, recency_days,
                generate_images, max_images, final_md, plan_json, evidence_json, sections_json,
                image_specs_json, created_at, updated_at
            ) VALUES (
                :output_slug, :title, :topic, :audience, :tone, :blog_length, :as_of, :mode, :recency_days,
                :generate_images, :max_images, :final_md, :plan_json, :evidence_json, :sections_json,
                :image_specs_json, :created_at, :updated_at
            )
            ON CONFLICT(output_slug) DO UPDATE SET
                title=excluded.title,
                topic=excluded.topic,
                audience=excluded.audience,
                tone=excluded.tone,
                blog_length=excluded.blog_length,
                as_of=excluded.as_of,
                mode=excluded.mode,
                recency_days=excluded.recency_days,
                generate_images=excluded.generate_images,
                max_images=excluded.max_images,
                final_md=excluded.final_md,
                plan_json=excluded.plan_json,
                evidence_json=excluded.evidence_json,
                sections_json=excluded.sections_json,
                image_specs_json=excluded.image_specs_json,
                updated_at=excluded.updated_at
            """,
            {
                "output_slug": payload["output_slug"],
                "title": payload["title"],
                "topic": payload.get("topic"),
                "audience": payload.get("audience"),
                "tone": payload.get("tone"),
                "blog_length": payload.get("blog_length"),
                "as_of": payload.get("as_of"),
                "mode": payload.get("mode"),
                "recency_days": payload.get("recency_days"),
                "generate_images": 1 if payload.get("generate_images", True) else 0,
                "max_images": int(payload.get("max_images", 3) or 0),
                "final_md": payload["final_md"],
                "plan_json": _json_dumps(payload.get("plan_json")),
                "evidence_json": _json_dumps(payload.get("evidence_json") or []),
                "sections_json": _json_dumps(payload.get("sections_json") or []),
                "image_specs_json": _json_dumps(payload.get("image_specs_json") or []),
                "created_at": payload["created_at"],
                "updated_at": payload["updated_at"],
            },
        )


def get_blog(output_slug: str) -> Optional[Dict[str, Any]]:
    init_db()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM blogs WHERE output_slug = ?", (output_slug,)).fetchone()
    if not row:
        return None
    data = dict(row)
    return {
        "output_slug": data["output_slug"],
        "output_dir": str(OUTPUTS_DIR / data["output_slug"]),
        "filename": data["output_slug"],
        "markdown_filename": "blog.md",
        "title": data["title"],
        "topic": data.get("topic") or data["title"],
        "audience": data.get("audience") or "technical readers",
        "tone": data.get("tone") or "clear and practical",
        "blog_length": data.get("blog_length") or "medium",
        "as_of": data.get("as_of") or "",
        "mode": data.get("mode") or "",
        "recency_days": data.get("recency_days") or 3650,
        "generate_images": bool(data.get("generate_images", 1)),
        "max_images": int(data.get("max_images") or 3),
        "final": data.get("final_md") or "",
        "plan": _json_loads(data.get("plan_json"), None),
        "evidence": _json_loads(data.get("evidence_json"), []),
        "sections": _json_loads(data.get("sections_json"), []),
        "image_specs": _json_loads(data.get("image_specs_json"), []),
        "created_at": data.get("created_at"),
        "updated_at": data.get("updated_at"),
    }


def list_blogs(limit: int = 50) -> List[Dict[str, Any]]:
    init_db()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT output_slug, title, updated_at FROM blogs ORDER BY updated_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    items: List[Dict[str, Any]] = []
    for row in rows:
        items.append(
            {
                "filename": row["output_slug"],
                "title": row["title"],
                "output_slug": row["output_slug"],
                "modified_at": datetime.fromisoformat(row["updated_at"]).timestamp() if row["updated_at"] else 0.0,
            }
        )
    return items


def import_blog_from_folder(output_slug: str, md_text: str, manifest: Optional[Dict[str, Any]] = None) -> None:
    manifest = manifest or {}
    title = manifest.get("title") or manifest.get("blog_title") or manifest.get("title_from_md")
    if not title:
        for line in md_text.splitlines():
            if line.startswith("# "):
                title = line[2:].strip()
                break
    title = title or output_slug
    upsert_blog(
        {
            "output_slug": output_slug,
            "title": title,
            "topic": manifest.get("topic") or title,
            "audience": manifest.get("audience"),
            "tone": manifest.get("tone"),
            "blog_length": manifest.get("blog_length"),
            "as_of": manifest.get("as_of"),
            "mode": manifest.get("mode"),
            "recency_days": manifest.get("recency_days"),
            "generate_images": manifest.get("generate_images", True),
            "max_images": manifest.get("max_images", 3),
            "final_md": md_text,
            "plan_json": manifest.get("plan"),
            "evidence_json": manifest.get("evidence"),
            "sections_json": manifest.get("sections"),
            "image_specs_json": manifest.get("image_specs"),
        }
    )


def save_blog_markdown(output_slug: str, markdown: str, title: Optional[str] = None) -> Optional[Dict[str, Any]]:
    init_db()
    record = get_blog(output_slug)
    if not record:
        return None

    output_dir = OUTPUTS_DIR / output_slug
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "blog.md").write_text(markdown, encoding="utf-8")

    updated = dict(record)
    updated["final_md"] = markdown
    if title:
        updated["title"] = title

    upsert_blog(
        {
            "output_slug": output_slug,
            "title": updated["title"],
            "topic": updated.get("topic"),
            "audience": updated.get("audience"),
            "tone": updated.get("tone"),
            "blog_length": updated.get("blog_length"),
            "as_of": updated.get("as_of"),
            "mode": updated.get("mode"),
            "recency_days": updated.get("recency_days"),
            "generate_images": updated.get("generate_images", True),
            "max_images": updated.get("max_images", 3),
            "final_md": markdown,
            "plan_json": updated.get("plan"),
            "evidence_json": updated.get("evidence"),
            "sections_json": updated.get("sections"),
            "image_specs_json": updated.get("image_specs"),
            "created_at": updated.get("created_at"),
        }
    )
    return get_blog(output_slug)
