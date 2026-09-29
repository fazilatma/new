"""Security, authentication hashing, session management, rate limiting, and audit logging."""
import os
import hmac
import hashlib
import secrets
import time
import re
from typing import Optional, Dict, Tuple, Any
from .database import get_db
from .config import get_raw_config

# Roles
ROLE_ADMIN = "Admin"
ROLE_DEVELOPER = "Developer"
ROLE_VIEWER = "Viewer"

# Password Hashing with PBKDF2
def hash_password(password: str, salt: Optional[str] = None) -> Tuple[str, str]:
    if not salt:
        salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100000)
    return dk.hex(), salt

def verify_password(password: str, password_hash: str, salt: str) -> bool:
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100000)
    return hmac.compare_digest(dk.hex(), password_hash)

# Session Management
SESSION_TTL_HOURS = 24

def create_session(user_id: str, ip: str = "", user_agent: str = "") -> str:
    token = secrets.token_urlsafe(32)
    expires_at = time.time() + (SESSION_TTL_HOURS * 3600)
    session_id = secrets.token_hex(16)
    with get_db() as conn:
        # If user does not exist (e.g. env-admin or anonymous), insert a placeholder record
        u = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        if not u:
            conn.execute("INSERT OR IGNORE INTO users (id, username, password_hash, salt, role, full_name) VALUES (?, ?, 'env', 'env', 'Admin', ?)", (user_id, user_id, user_id))
        conn.execute("""
        INSERT INTO sessions (id, user_id, token, expires_at, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (session_id, user_id, token, expires_at, ip, user_agent))
    return token

def validate_session(token: str) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    # Check legacy token env if set
    env_token = get_raw_config("AGENT_AUTH_TOKEN")
    if env_token and hmac.compare_digest(token, env_token):
        return {
            "id": "env-admin",
            "username": "env-admin",
            "role": ROLE_ADMIN,
            "full_name": "Environment Admin"
        }

    now = time.time()
    with get_db() as conn:
        row = conn.execute("""
        SELECT u.id, u.username, u.role, u.full_name, s.id as session_id, s.expires_at
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token = ? AND s.expires_at > ?
        """, (token, now)).fetchone()

        if row:
            # Update last_active
            conn.execute("UPDATE sessions SET last_active = datetime('now') WHERE id = ?", (row["session_id"],))
            return {
                "id": row["id"],
                "username": row["username"],
                "role": row["role"],
                "full_name": row["full_name"],
                "session_id": row["session_id"]
            }
    return None

def renew_session(token: str) -> bool:
    now = time.time()
    new_expires = now + (SESSION_TTL_HOURS * 3600)
    with get_db() as conn:
        res = conn.execute("""
        UPDATE sessions SET expires_at = ? WHERE token = ? AND expires_at > ?
        """, (new_expires, token, now))
        return res.rowcount > 0

def delete_session(token: str) -> bool:
    with get_db() as conn:
        res = conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        return res.rowcount > 0

def delete_all_user_sessions(user_id: str) -> int:
    with get_db() as conn:
        res = conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        return res.rowcount

# Rate Limiter
_RATE_LIMIT_STORE: Dict[str, list] = {}

def check_rate_limit(key: str, limit: int = 120, window_seconds: int = 60) -> bool:
    now = time.time()
    cutoff = now - window_seconds
    timestamps = _RATE_LIMIT_STORE.get(key, [])
    # Prune old timestamps
    timestamps = [t for t in timestamps if t > cutoff]
    if len(timestamps) >= limit:
        _RATE_LIMIT_STORE[key] = timestamps
        return False
    timestamps.append(now)
    _RATE_LIMIT_STORE[key] = timestamps
    return True

# Security Audit Logging
def log_security_event(event: str, status: str, details: str = "", ip: str = "", user_id: str = "", conn: Optional[Any] = None):
    sanitized_details = mask_log_tokens(details)
    if conn is not None:
        conn.execute("""
        INSERT INTO security_logs (ip, user_id, event, status, details)
        VALUES (?, ?, ?, ?, ?)
        """, (ip, user_id, event, status, sanitized_details))
    else:
        with get_db() as db_conn:
            db_conn.execute("""
            INSERT INTO security_logs (ip, user_id, event, status, details)
            VALUES (?, ?, ?, ?, ?)
            """, (ip, user_id, event, status, sanitized_details))

# Token & Secret Masking in Logs
SENSITIVE_PATTERNS = [
    re.compile(r'(Bearer\s+)([A-Za-z0-9_\-\.]{8,})', re.IGNORECASE),
    re.compile(r'((?:key|token|password|secret|authorization)["\']?\s*[:=]\s*["\']?)([A-Za-z0-9_\-\.]{8,})(["\']?)', re.IGNORECASE),
    re.compile(r'(sk-[A-Za-z0-9_-]{10,})', re.IGNORECASE),
    re.compile(r'(ghp_[A-Za-z0-9]{20,})', re.IGNORECASE),
]

def mask_log_tokens(text: str) -> str:
    if not text:
        return ""
    result = text
    for pattern in SENSITIVE_PATTERNS:
        result = pattern.sub(r'\1••••••••', result)
    return result

# CSRF Token Support
_CSRF_STORE: Dict[str, float] = {}

def generate_csrf_token(session_id: str) -> str:
    token = secrets.token_hex(16)
    _CSRF_STORE[f"{session_id}:{token}"] = time.time() + 86400
    return token

def validate_csrf_token(session_id: str, token: str) -> bool:
    key = f"{session_id}:{token}"
    exp = _CSRF_STORE.get(key)
    if exp and exp > time.time():
        return True
    return False

# Ensure Initial Admin User exists if DB empty
def ensure_initial_admin():
    with get_db() as conn:
        count = conn.execute("SELECT COUNT(*) as c FROM users").fetchone()["c"]
        if count == 0:
            pw_hash, salt = hash_password("admin123")
            admin_id = "user-admin-" + secrets.token_hex(4)
            conn.execute("""
            INSERT INTO users (id, username, password_hash, salt, role, full_name)
            VALUES (?, ?, ?, ?, ?, ?)
            """, (admin_id, "admin", pw_hash, salt, ROLE_ADMIN, "System Administrator"))
            log_security_event("INITIAL_ADMIN_CREATED", "success", "Default admin account created: username 'admin'", ip="127.0.0.1", user_id=admin_id, conn=conn)

ensure_initial_admin()
