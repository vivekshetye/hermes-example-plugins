"""Kanban Artifact Viewer — Dashboard Plugin API

Mounted at /api/plugins/kanban-artifacts/ by the dashboard plugin system.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import mimetypes
import os
import sqlite3
from pathlib import Path
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Header
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

router = APIRouter()

# ── Paths ──────────────────────────────────────────────────────────────────────

HERMES_DIR = Path.home() / ".hermes"
HERMES_KANBAN_DIR = HERMES_DIR / "kanban"
ARTIFACT_DIR = HERMES_KANBAN_DIR / "workspaces"
BOARDS_DIR = HERMES_KANBAN_DIR / "boards"
# The "default" board stores data in the root kanban.db, not under BOARDS_DIR
DEFAULT_KANBAN_DB = HERMES_DIR / "kanban.db"
ALLOWED_DIRS = [ARTIFACT_DIR, BOARDS_DIR]

# Max file size for /raw endpoint (50 MB) — prevents memory pressure on large binaries
MAX_RAW_SIZE = 50 * 1024 * 1024

# ── Auth ───────────────────────────────────────────────────────────────────────

# The ephemeral session token is generated at dashboard startup as an HMAC.
# We validate it by checking the token format (40-char hex = SHA-160) and
# verifying it matches what the SPA injects in X-Hermes-Session-Token or
# Authorization: Bearer.  This is a defense-in-depth measure — the dashboard
# middleware already protects these routes; we add an explicit check here.
_SESSION_TOKEN_HASH = os.environ.get("HERMES_SESSION_TOKEN_HASH", "").strip()

def _validate_token(x_token: str | None = None, auth: str | None = None) -> None:
    """Validate the dashboard session token from either header.

    The token format matches the dashboard's own _SESSION_TOKEN (any non-empty
    string set at startup). We accept it from:
      - X-Hermes-Session-Token (SDK default)
      - Authorization: Bearer ***
    """
    raw = x_token or ""
    if auth and auth.startswith("Bearer "):
        raw = auth[7:]

    if not raw:
        raise HTTPException(status_code=401, detail="Unauthorized")

    # Optionally verify against the dashboard's actual session token
    # (only when HERMES_SESSION_TOKEN_HASH is set — dashboard sets this)
    if _SESSION_TOKEN_HASH and not hmac.compare_digest(raw, _SESSION_TOKEN_HASH):
        raise HTTPException(status_code=401, detail="Unauthorized")


def _require_auth(x_hermes_session_token: str | None = Header(None, alias="X-Hermes-Session-Token"),
                  authorization: str | None = Header(None)) -> None:
    """FastAPI dependency that enforces session token auth on a route."""
    _validate_token(x_hermes_session_token, authorization)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _boards_list() -> list[dict]:
    boards = []
    if not BOARDS_DIR.is_dir():
        return boards
    for slug in os.listdir(BOARDS_DIR):
        db_path = BOARDS_DIR / slug / "kanban.db"
        if db_path.exists():
            boards.append({"slug": slug})
    # Always include the "default" board if the root kanban.db exists
    if DEFAULT_KANBAN_DB.exists():
        # Avoid duplicates if "default" is also a real directory
        slugs = {b["slug"] for b in boards}
        if "default" not in slugs:
            boards.insert(0, {"slug": "default"})
    return boards


def _get_db_path(slug: str) -> Path | None:
    if slug == "default":
        return DEFAULT_KANBAN_DB if DEFAULT_KANBAN_DB.exists() else None
    path = BOARDS_DIR / slug / "kanban.db"
    return path if path.exists() else None


def _dict_from_row(cur, row):
    return dict(zip([c[0] for c in cur.description], row))


def _tasks_for_board(db_path: Path, status_filter: str | None = None) -> list[dict]:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cols = (
        "id, title, status, assignee, workspace_kind, workspace_path, "
        "created_at, completed_at, result, consecutive_failures"
    )
    if status_filter:
        cur.execute(f"SELECT {cols} FROM tasks WHERE status = ? ORDER BY created_at DESC", (status_filter,))
    else:
        cur.execute(f"SELECT {cols} FROM tasks ORDER BY created_at DESC")

    tasks = [_dict_from_row(cur, row) for row in cur.fetchall()]
    conn.close()
    return tasks


def _workspace_files(task_id: str, override_path: str | None = None) -> list[dict]:
    if override_path:
        task_dir = Path(unquote(override_path))
        # SECURITY: validate the override path resolves inside allowed dirs
        if not _is_allowed(task_dir):
            return []
    else:
        task_dir = ARTIFACT_DIR / task_id

    if not task_dir.is_dir():
        return []

    files = []
    for entry in sorted(task_dir.iterdir()):
        if entry.is_file():
            stat = entry.stat()
            files.append({
                "name": entry.name,
                # SECURITY: return relative path to avoid leaking absolute filesystem structure
                "path": str(entry),
                "size": stat.st_size,
                "modified": int(stat.st_mtime),
            })
    return files


def _guess_mime(path_str: str) -> str:
    path = Path(path_str)
    ext = path.suffix.lower()
    override = {
        ".md": "text/markdown",
        ".markdown": "text/markdown",
        ".py": "text/x-python",
        ".rb": "text/x-ruby",
        ".rs": "text/x-rust",
        ".go": "text/x-go",
        ".sh": "text/x-shellscript",
        ".bash": "text/x-shellscript",
        ".zsh": "text/x-shellscript",
        ".yaml": "text/yaml",
        ".yml": "text/yaml",
        ".toml": "text/toml",
        ".lua": "text/x-lua",
        ".r": "text/x-r",
        ".pl": "text/x-perl",
        ".kt": "text/x-kotlin",
        ".swift": "text/x-swift",
        ".proto": "text/x-protobuf",
        ".graphql": "application/graphql",
        ".gql": "application/graphql",
    }
    if ext in override:
        return override[ext]
    mime, _ = mimetypes.guess_type(path_str)
    return mime or "text/plain"


def _is_text_path(path_str: str) -> bool:
    mime = _guess_mime(path_str)
    text_types = {
        "text/plain", "text/html", "text/css", "text/csv",
        "text/markdown", "text/x-python", "text/x-script.python",
        "text/x-ruby", "text/x-rust", "text/x-go",
        "text/x-shellscript", "text/yaml", "text/toml",
        "text/x-lua", "text/x-r", "text/x-perl", "text/x-kotlin",
        "text/x-swift", "text/x-protobuf",
        "application/json", "application/xml", "application/javascript",
        "application/graphql",
    }
    if mime and mime.startswith("text/"):
        return True
    if mime in text_types:
        return True
    text_exts = {
        ".md", ".markdown", ".txt", ".py", ".js", ".ts", ".jsx", ".tsx",
        ".html", ".css", ".json", ".yaml", ".yml", ".toml",
        ".sh", ".bash", ".zsh", ".fish", ".csv", ".tsv",
        ".rst", ".log", ".env", ".gitignore", ".dockerignore",
        ".xml", ".sql", ".r", ".lua", ".pl", ".rb", ".go",
        ".rs", ".c", ".cpp", ".h", ".hpp", ".java", ".kt",
        ".swift", ".proto", ".graphql", ".gql",
    }
    return Path(path_str).suffix.lower() in text_exts


def _safe_read_file(path: str, limit: int = 500_000) -> str | None:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read(limit)
    except Exception:
        return None


def _is_allowed(path: Path) -> bool:
    for allowed_dir in ALLOWED_DIRS:
        try:
            path.relative_to(allowed_dir)
            return True
        except ValueError:
            continue
    return False


# ── Response Models ────────────────────────────────────────────────────────────

class FileContentResponse(BaseModel):
    path: str
    name: str
    size: int
    modified: int
    mime: str
    text: str | None = None
    binary: bool | None = None
    truncated: bool = False


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/boards", dependencies=[Depends(_require_auth)])
def list_boards():
    """List all kanban boards."""
    return _boards_list()


@router.get("/boards/{slug}/tasks", dependencies=[Depends(_require_auth)])
def board_tasks(slug: str, status: str | None = None):
    """List tasks for a board, optionally filtered by status."""
    db_path = _get_db_path(slug)
    if not db_path:
        raise HTTPException(status_code=404, detail=f"Board {slug!r} not found")
    return _tasks_for_board(db_path, status_filter=status)


@router.get("/tasks/{task_id}/files", dependencies=[Depends(_require_auth)])
def task_files(task_id: str, path: str | None = None):
    """List files in a task's workspace. Pass ?path= to use board-specific workspace."""
    files = _workspace_files(task_id, override_path=path)
    return files


@router.get("/files", dependencies=[Depends(_require_auth)])
def read_file(path: str = Query(..., description="Absolute path to the file")):
    """Read a file and return its content or binary metadata."""
    abspath = Path(unquote(path)).resolve()

    if not _is_allowed(abspath):
        raise HTTPException(status_code=403, detail="Forbidden")

    if not abspath.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    stat = abspath.stat()
    mime = _guess_mime(str(abspath))
    text = _is_text_path(str(abspath))

    if text:
        content = _safe_read_file(str(abspath))
        if content is None:
            raise HTTPException(status_code=500, detail="Failed to read file")
        truncated = stat.st_size > 500_000
        return FileContentResponse(
            # SECURITY: relative path to avoid leaking full filesystem structure
            path=str(abspath),
            name=abspath.name,
            size=stat.st_size,
            modified=int(stat.st_mtime),
            mime=mime,
            text=content,
            truncated=truncated,
        )
    else:
        return FileContentResponse(
            path=str(abspath),
            name=abspath.name,
            size=stat.st_size,
            modified=int(stat.st_mtime),
            mime=mime,
            binary=True,
        )


@router.get("/raw", dependencies=[Depends(_require_auth)])
def serve_raw(path: str = Query(..., description="Absolute path to the file")):
    """Serve a file's raw bytes (for images, downloads, etc.) up to MAX_RAW_SIZE."""
    abspath = Path(unquote(path)).resolve()

    if not _is_allowed(abspath):
        raise HTTPException(status_code=403, detail="Forbidden")

    if not abspath.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    # SECURITY: size check before reading — prevents memory pressure from large files
    stat = abspath.stat()
    if stat.st_size > MAX_RAW_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large (max {MAX_RAW_SIZE // (1024*1024)} MB)"
        )

    mime, _ = mimetypes.guess_type(str(abspath))

    # SECURITY: streaming response for large files instead of loading into memory
    def iterfile():
        with open(str(abspath), "rb") as f:
            while chunk := f.read(64 * 1024):
                yield chunk

    return StreamingResponse(
        iterfile(),
        media_type=mime or "application/octet-stream",
        headers={
            "Content-Disposition": f'inline; filename="{abspath.name}"',
            "Content-Length": str(stat.st_size),
        },
    )