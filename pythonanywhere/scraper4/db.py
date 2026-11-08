"""لایهٔ داده — جایگزینِ فایل‌های JSONِ نسخهٔ قدیمی و مدل‌های Eloquentِ لاراول.

  profiles.json            → profiles + products
  connections.json         → connections   (config رمزشده)
  bsl_queue/woo_queue.json → queue_entries
  *_progress.json          → task_checkpoints

SQLite انتخاب شده چون روی PythonAnywhere بدونِ سرویسِ جدا کار می‌کند،
با WAL هم‌زمانیِ خواندن/نوشتنِ سبک دارد؛ برای پشتیبان از فرمان backup استفاده کنید.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

from .services.support.crypto import seal, unseal

SCHEMA = """
CREATE TABLE IF NOT EXISTS profiles (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    key               TEXT NOT NULL UNIQUE,
    name              TEXT NOT NULL DEFAULT '',
    url               TEXT NOT NULL,
    selectors         TEXT,
    pagination        TEXT,
    settings          TEXT,
    products_count    INTEGER NOT NULL DEFAULT 0,
    last_scraped_at   TEXT,
    enabled           INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profiles_enabled ON profiles (enabled);

CREATE TABLE IF NOT EXISTS products (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id    INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    key           TEXT NOT NULL,
    title         TEXT NOT NULL DEFAULT '',
    price         TEXT NOT NULL DEFAULT '',
    price_num     INTEGER NOT NULL DEFAULT 0,
    link          TEXT NOT NULL DEFAULT '',
    image         TEXT NOT NULL DEFAULT '',
    sku           TEXT NOT NULL DEFAULT '',
    extra         TEXT,
    basalam_id    INTEGER,
    woo_id        INTEGER,
    last_seen_at  TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    UNIQUE (profile_id, key)
);
CREATE INDEX IF NOT EXISTS idx_products_profile ON products (profile_id);
CREATE INDEX IF NOT EXISTS idx_products_woo ON products (woo_id);
CREATE INDEX IF NOT EXISTS idx_products_bsl ON products (basalam_id);

CREATE TABLE IF NOT EXISTS connections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    config      TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS queue_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL,
    batch_id    TEXT,
    profile_id  INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
    status      TEXT NOT NULL DEFAULT 'waiting',
    payload     TEXT,
    counters    TEXT,
    started_at  TEXT,
    done_at     TEXT,
    error       TEXT NOT NULL DEFAULT '',
    heartbeat   TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_queue_kind_status ON queue_entries (kind, status);
CREATE INDEX IF NOT EXISTS idx_queue_batch ON queue_entries (batch_id);

CREATE TABLE IF NOT EXISTS task_checkpoints (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    task            TEXT NOT NULL UNIQUE,
    queue_entry_id  INTEGER REFERENCES queue_entries(id) ON DELETE SET NULL,
    state           TEXT,
    heartbeat_at    TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
"""

ALIVE_STATUSES = ("waiting", "running", "paused")


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            return None


def _json(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _load(value: str | None, default):
    if not value:
        return default
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return default


def _row(row: sqlite3.Row | None, json_fields: tuple[str, ...] = ()) -> dict | None:
    if row is None:
        return None
    data = dict(row)
    for field in json_fields:
        data[field] = _load(data.get(field), {} if field != "counters" else {})
    return data


class DB:
    """مخزنِ دادهٔ اپ؛ یک نمونه در create_app ساخته و همه‌جا پاس داده می‌شود."""

    def __init__(self, path: str | Path, secret_key: str = ""):
        self.path = Path(path)
        self.secret_key = secret_key
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.init_schema()

    # ------------------------------------------------------------- اتصال

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(str(self.path), timeout=20)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def init_schema(self) -> None:
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.executescript(SCHEMA)

    # ------------------------------------------------------------- profiles

    def upsert_profile(self, key: str, url: str, name: str = "",
                       selectors: dict | None = None,
                       pagination: dict | None = None,
                       settings: dict | None = None,
                       enabled: bool = True) -> dict:
        now = utc_now()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO profiles (key, name, url, selectors, pagination, settings,
                                      enabled, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    name = excluded.name,
                    url = excluded.url,
                    selectors = excluded.selectors,
                    pagination = excluded.pagination,
                    settings = excluded.settings,
                    enabled = excluded.enabled,
                    updated_at = excluded.updated_at
                """,
                (key, name, url, _json(selectors or {}), _json(pagination or {}),
                 _json(settings or {}), 1 if enabled else 0, now, now),
            )
            row = conn.execute("SELECT * FROM profiles WHERE key = ?", (key,)).fetchone()
        return _row(row, ("selectors", "pagination", "settings")) or {}

    def list_profiles(self) -> list[dict]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM profiles ORDER BY id DESC").fetchall()
        return [_row(r, ("selectors", "pagination", "settings")) or {} for r in rows]

    def get_profile(self, key_or_id) -> dict | None:
        with self.connect() as conn:
            if isinstance(key_or_id, int) or str(key_or_id).isdigit():
                row = conn.execute("SELECT * FROM profiles WHERE id = ?",
                                   (int(key_or_id),)).fetchone()
            else:
                row = conn.execute("SELECT * FROM profiles WHERE key = ?",
                                   (str(key_or_id),)).fetchone()
        return _row(row, ("selectors", "pagination", "settings"))

    def set_profile_enabled(self, key_or_id, enabled: bool) -> None:
        with self.connect() as conn:
            conn.execute(
                "UPDATE profiles SET enabled = ?, updated_at = ? WHERE "
                + ("id = ?" if str(key_or_id).isdigit() else "key = ?"),
                (1 if enabled else 0, utc_now(), int(key_or_id) if str(key_or_id).isdigit()
                 else str(key_or_id)),
            )

    def delete_profile(self, key_or_id) -> None:
        with self.connect() as conn:
            if str(key_or_id).isdigit():
                conn.execute("DELETE FROM profiles WHERE id = ?", (int(key_or_id),))
            else:
                conn.execute("DELETE FROM profiles WHERE key = ?", (str(key_or_id),))

    def touch_profile(self, profile_id: int, products_count: int | None = None) -> None:
        with self.connect() as conn:
            if products_count is None:
                conn.execute("UPDATE profiles SET last_scraped_at = ?, updated_at = ? WHERE id = ?",
                             (utc_now(), utc_now(), profile_id))
            else:
                conn.execute(
                    "UPDATE profiles SET last_scraped_at = ?, products_count = ?, updated_at = ?"
                    " WHERE id = ?", (utc_now(), products_count, utc_now(), profile_id))

    # ------------------------------------------------------------- products

    def upsert_product(self, profile_id: int, key: str, row: dict) -> None:
        now = utc_now()
        extra = row.get("extra")
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO products (profile_id, key, title, price, price_num, link,
                                      image, sku, extra, last_seen_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(profile_id, key) DO UPDATE SET
                    title = excluded.title,
                    price = excluded.price,
                    price_num = excluded.price_num,
                    link = excluded.link,
                    image = excluded.image,
                    sku = excluded.sku,
                    extra = COALESCE(excluded.extra, products.extra),
                    last_seen_at = excluded.last_seen_at,
                    updated_at = excluded.updated_at
                """,
                (profile_id, key, row.get("title", ""), row.get("price", ""),
                 int(row.get("price_num") or 0), row.get("link", ""), row.get("image", ""),
                 row.get("sku", ""), _json(extra) if extra else None, now, now, now),
            )

    def list_products(self, profile_id: int | None = None, limit: int = 500,
                      offset: int = 0, only_missing_woo: bool = False,
                      only_missing_bsl: bool = False) -> list[dict]:
        where, params = [], []
        if profile_id is not None:
            where.append("profile_id = ?")
            params.append(profile_id)
        if only_missing_woo:
            where.append("woo_id IS NULL")
        if only_missing_bsl:
            where.append("basalam_id IS NULL")
        clause = ("WHERE " + " AND ".join(where)) if where else ""
        sql = f"SELECT * FROM products {clause} ORDER BY id LIMIT ? OFFSET ?"
        with self.connect() as conn:
            rows = conn.execute(sql, (*params, limit, offset)).fetchall()
        return [_row(r, ("extra",)) or {} for r in rows]

    def count_products(self, profile_id: int | None = None) -> int:
        with self.connect() as conn:
            if profile_id is None:
                return int(conn.execute("SELECT COUNT(*) FROM products").fetchone()[0])
            return int(conn.execute("SELECT COUNT(*) FROM products WHERE profile_id = ?",
                                    (profile_id,)).fetchone()[0])

    def mark_product_target(self, product_id: int, target: str, remote_id: int) -> None:
        column = "woo_id" if target == "woo" else "basalam_id"
        with self.connect() as conn:
            conn.execute(f"UPDATE products SET {column} = ?, updated_at = ? WHERE id = ?",
                         (int(remote_id), utc_now(), product_id))

    def sync_profile_count(self, profile_id: int) -> int:
        count = self.count_products(profile_id)
        with self.connect() as conn:
            conn.execute("UPDATE profiles SET products_count = ?, updated_at = ? WHERE id = ?",
                         (count, utc_now(), profile_id))
        return count

    # ---------------------------------------------------------- connections

    def get_config(self, name: str, default: dict | None = None) -> dict:
        with self.connect() as conn:
            row = conn.execute("SELECT config FROM connections WHERE name = ?",
                               (name,)).fetchone()
        if not row:
            return dict(default or {})
        try:
            value = unseal(row["config"], self.secret_key)
        except ValueError:
            value = {}
        if not isinstance(value, dict):
            value = {}
        return {**dict(default or {}), **value}

    def put_config(self, name: str, config: dict) -> None:
        now = utc_now()
        payload = seal(dict(config), self.secret_key)
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO connections (name, config, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(name) DO UPDATE SET config = excluded.config,
                    updated_at = excluded.updated_at
                """,
                (name, payload, now, now),
            )

    def list_connections(self) -> list[dict]:
        with self.connect() as conn:
            rows = conn.execute("SELECT name, updated_at FROM connections ORDER BY name").fetchall()
        return [dict(r) for r in rows]

    # --------------------------------------------------------------- queue

    def enqueue(self, kind: str, profile_id: int | None = None,
                payload: dict | None = None, batch_id: str | None = None,
                status: str = "waiting") -> int:
        now = utc_now()
        with self.connect() as conn:
            cursor = conn.execute(
                """INSERT INTO queue_entries
                   (kind, batch_id, profile_id, status, payload, counters, created_at,
                    updated_at, heartbeat)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (kind, batch_id, profile_id, status, _json(payload or {}),
                 _json({"total": 0, "sent": 0, "updated": 0, "skipped": 0,
                        "failed": 0, "current": 0}),
                 now, now, now),
            )
            return int(cursor.lastrowid)

    def claim_next(self, kinds: tuple[str, ...] = ("extract", "woo_send", "bsl_send")
                   ) -> dict | None:
        placeholders = ",".join("?" for _ in kinds)
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                f"""SELECT * FROM queue_entries WHERE status = 'waiting'
                    AND kind IN ({placeholders}) ORDER BY id LIMIT 1""",
                kinds,
            ).fetchone()
            if not row:
                return None
            conn.execute(
                "UPDATE queue_entries SET status = 'running', started_at = ?, heartbeat = ?,"
                " updated_at = ? WHERE id = ?",
                (utc_now(), utc_now(), utc_now(), row["id"]),
            )
        return _row(row, ("payload", "counters"))

    def update_entry(self, entry_id: int, **fields) -> None:
        if not fields:
            return
        allowed = {"status", "error", "started_at", "done_at", "payload", "counters",
                   "batch_id", "heartbeat"}
        sets, params = [], []
        for key, value in fields.items():
            if key not in allowed:
                continue
            if key in ("payload", "counters"):
                value = _json(value)
            sets.append(f"{key} = ?")
            params.append(value)
        if not sets:
            return
        sets.append("updated_at = ?")
        params.append(utc_now())
        params.append(entry_id)
        with self.connect() as conn:
            conn.execute(f"UPDATE queue_entries SET {', '.join(sets)} WHERE id = ?", params)

    def finish_entry(self, entry_id: int, status: str = "done", error: str = "") -> None:
        self.update_entry(entry_id, status=status, error=error[:500], done_at=utc_now())

    def get_entry(self, entry_id: int) -> dict | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM queue_entries WHERE id = ?",
                               (entry_id,)).fetchone()
        return _row(row, ("payload", "counters"))

    def list_entries(self, alive_only: bool = False, limit: int = 50) -> list[dict]:
        clause = "WHERE status IN ('waiting','running','paused')" if alive_only else ""
        with self.connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM queue_entries {clause} ORDER BY id DESC LIMIT ?",
                (limit,)).fetchall()
        return [_row(r, ("payload", "counters")) or {} for r in rows]

    def heartbeat(self, entry_id: int) -> None:
        self.update_entry(entry_id, heartbeat=utc_now())

    def recover_stale(self, stale_seconds: int = 900) -> int:
        """Resume stale reads; pause stale remote writes for manual reconciliation."""
        cutoff = (datetime.now(timezone.utc) - timedelta(seconds=stale_seconds)).strftime(
            "%Y-%m-%d %H:%M:%S")
        with self.connect() as conn:
            cursor = conn.execute(
                """UPDATE queue_entries SET
                       status = CASE WHEN kind = 'extract' THEN 'waiting' ELSE 'paused' END,
                       error = CASE WHEN kind = 'extract' THEN ''
                           ELSE 'Worker interrupted: reconcile remote products before resuming' END,
                       started_at = NULL, heartbeat = NULL, updated_at = ?
                   WHERE status = 'running'
                     AND COALESCE(heartbeat, started_at, updated_at) < ?""",
                (utc_now(), cutoff),
            )
            return int(cursor.rowcount or 0)

    # --------------------------------------------------------- checkpoints

    def checkpoint_write(self, task: str, state: dict,
                         queue_entry_id: int | None = None) -> None:
        now = utc_now()
        with self.connect() as conn:
            conn.execute(
                """INSERT INTO task_checkpoints
                       (task, queue_entry_id, state, heartbeat_at, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(task) DO UPDATE SET
                       state = excluded.state,
                       queue_entry_id = COALESCE(excluded.queue_entry_id,
                                                 task_checkpoints.queue_entry_id),
                       heartbeat_at = excluded.heartbeat_at,
                       updated_at = excluded.updated_at""",
                (task, queue_entry_id, _json(state), now, now, now),
            )

    def checkpoint_read(self, task: str, default: dict | None = None) -> dict:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM task_checkpoints WHERE task = ?",
                               (task,)).fetchone()
        if not row:
            return dict(default or {})
        return {**dict(default or {}), **(_load(row["state"], {}) or {})}

    def checkpoint_beat(self, task: str) -> None:
        with self.connect() as conn:
            conn.execute("UPDATE task_checkpoints SET heartbeat_at = ?, updated_at = ?"
                         " WHERE task = ?", (utc_now(), utc_now(), task))

    def checkpoint_clear(self, task: str) -> None:
        with self.connect() as conn:
            conn.execute("DELETE FROM task_checkpoints WHERE task = ?", (task,))

    # ---------------------------------------------------------- stop signal

    def stop_set(self, key: str, ttl_seconds: int = 900) -> None:
        self.checkpoint_write(f"stop:{key}", {"until": (datetime.now(timezone.utc)
                                                       + timedelta(seconds=ttl_seconds))
                                              .strftime("%Y-%m-%d %H:%M:%S")})

    def stop_active(self, key: str) -> bool:
        state = self.checkpoint_read(f"stop:{key}", {})
        until = parse_ts(state.get("until"))
        if until is None:
            return False
        if until <= datetime.now(timezone.utc):
            self.stop_clear(key)
            return False
        return True

    def stop_clear(self, key: str) -> None:
        self.checkpoint_clear(f"stop:{key}")

    # ------------------------------------------------------------- آمار کلی

    def stats(self) -> dict:
        with self.connect() as conn:
            profiles = int(conn.execute("SELECT COUNT(*) FROM profiles").fetchone()[0])
            enabled = int(conn.execute("SELECT COUNT(*) FROM profiles WHERE enabled = 1")
                          .fetchone()[0])
            products = int(conn.execute("SELECT COUNT(*) FROM products").fetchone()[0])
            alive = int(conn.execute(
                "SELECT COUNT(*) FROM queue_entries WHERE status IN"
                " ('waiting','running','paused')").fetchone()[0])
            last = conn.execute("SELECT MAX(last_scraped_at) FROM profiles").fetchone()[0]
        return {"profiles": profiles, "profiles_enabled": enabled, "products": products,
                "queue_alive": alive, "last_scrape": last}
