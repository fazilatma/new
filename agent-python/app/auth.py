"""Authentication API endpoints, Role-Based Access Control, and Security Middleware."""
import uuid
import secrets
from typing import Optional, List, Dict, Any
from fastapi import Request, HTTPException, Depends
from fastapi.responses import JSONResponse, Response, RedirectResponse
from pydantic import BaseModel, Field

from .config import is_auth_enabled, get_raw_config
from .database import get_db
from .security import (
    hash_password, verify_password, create_session, validate_session,
    renew_session, delete_session, delete_all_user_sessions, check_rate_limit,
    log_security_event, generate_csrf_token, ROLE_ADMIN, ROLE_DEVELOPER, ROLE_VIEWER
)

class LoginRequest(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    token: Optional[str] = None

class ChangePasswordRequest(BaseModel):
    oldPassword: str
    newPassword: str

class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str = ROLE_DEVELOPER
    fullName: Optional[str] = ""

class UpdateRoleRequest(BaseModel):
    role: str

def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

def get_session_token(request: Request) -> Optional[str]:
    # Check Cookie
    token = request.cookies.get("arena_session")
    if token:
        return token
    # Check Authorization Header
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:].strip()
    # Check custom X-Auth-Token header
    return request.headers.get("X-Auth-Token")

async def get_current_user_optional(request: Request) -> Optional[Dict[str, Any]]:
    token = get_session_token(request)
    if not token:
        return None
    return validate_session(token)

async def get_current_user(request: Request) -> Dict[str, Any]:
    if not is_auth_enabled():
        return {
            "id": "anonymous-admin",
            "username": "admin",
            "role": ROLE_ADMIN,
            "full_name": "Anonymous Superuser"
        }
    user = await get_current_user_optional(request)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user

def require_role(allowed_roles: List[str]):
    async def dependency(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
        if user.get("role") not in allowed_roles:
            raise HTTPException(status_code=403, detail=f"Permission denied. Required role: {', '.join(allowed_roles)}")
        return user
    return dependency

require_admin = require_role([ROLE_ADMIN])
require_developer = require_role([ROLE_ADMIN, ROLE_DEVELOPER])
require_viewer = require_role([ROLE_ADMIN, ROLE_DEVELOPER, ROLE_VIEWER])

# Authentication Middleware
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    ip = get_client_ip(request)

    # Rate limiting on all API routes
    if path.startswith("/api/"):
        rate_key = f"rate:{ip}:{path}"
        limit = 30 if "login" in path else 200
        if not check_rate_limit(rate_key, limit=limit, window_seconds=60):
            log_security_event("RATE_LIMIT_EXCEEDED", "blocked", f"Rate limit exceeded on {path}", ip=ip)
            return JSONResponse({"detail": "Rate limit exceeded. Please try again later."}, status_code=429)

    # Public routes allowed without auth
    public_paths = (
        "/health",
        "/api/version",
        "/api/auth/status",
        "/api/auth/login",
        "/docs",
        "/openapi.json",
        "/redoc",
        "/static/login.html"
    )

    if not is_auth_enabled() or path in public_paths:
        return await call_next(request)

    # Check for authentication
    token = get_session_token(request)
    user = validate_session(token) if token else None

    if not user:
        # If web UI path, let the frontend handle showing login or return 401
        if path.startswith("/api/"):
            log_security_event("UNAUTHORIZED_API_ACCESS", "failed", f"Unauthorized access to {path}", ip=ip)
            return JSONResponse({"detail": "Authentication required"}, status_code=401)

    return await call_next(request)

# Router handlers for Auth
def register_auth_routes(app):
    @app.get("/api/auth/status")
    async def auth_status(request: Request):
        enabled = is_auth_enabled()
        user = await get_current_user_optional(request)
        return {
            "enabled": enabled,
            "authenticated": bool(user),
            "user": user
        }

    @app.post("/api/auth/login")
    async def auth_login(payload: LoginRequest, request: Request, response: Response):
        ip = get_client_ip(request)
        ua = request.headers.get("User-Agent", "")

        # 1. Direct Token Check
        if payload.token:
            env_token = get_raw_config("AGENT_AUTH_TOKEN")
            if env_token and payload.token.strip() == env_token:
                session_token = create_session("env-admin", ip=ip, user_agent=ua)
                response.set_cookie(
                    key="arena_session",
                    value=session_token,
                    httponly=True,
                    samesite="lax",
                    secure=False,
                    max_age=SESSION_TTL_HOURS * 3600
                )
                log_security_event("LOGIN_SUCCESS_TOKEN", "success", "Admin logged in via token", ip=ip, user_id="env-admin")
                return {"ok": True, "token": session_token, "user": {"username": "admin", "role": ROLE_ADMIN}}

        # 2. Username / Password Check
        if payload.username and payload.password:
            with get_db() as conn:
                row = conn.execute("SELECT id, username, password_hash, salt, role, full_name FROM users WHERE username = ?", (payload.username,)).fetchone()
                if row and verify_password(payload.password, row["password_hash"], row["salt"]):
                    session_token = create_session(row["id"], ip=ip, user_agent=ua)
                    response.set_cookie(
                        key="arena_session",
                        value=session_token,
                        httponly=True,
                        samesite="lax",
                        secure=False,
                        max_age=SESSION_TTL_HOURS * 3600
                    )
                    user_info = {
                        "id": row["id"],
                        "username": row["username"],
                        "role": row["role"],
                        "full_name": row["full_name"]
                    }
                    log_security_event("LOGIN_SUCCESS", "success", f"User {row['username']} logged in", ip=ip, user_id=row["id"])
                    return {"ok": True, "token": session_token, "user": user_info}

        log_security_event("LOGIN_FAILED", "failed", f"Failed login attempt for username: {payload.username}", ip=ip)
        raise HTTPException(status_code=401, detail="Invalid username or password")

    @app.post("/api/auth/logout")
    async def auth_logout(request: Request, response: Response):
        token = get_session_token(request)
        if token:
            delete_session(token)
        response.delete_cookie("arena_session")
        return {"ok": True}

    @app.post("/api/auth/logout-all")
    async def auth_logout_all(request: Request, response: Response, user: Dict[str, Any] = Depends(get_current_user)):
        delete_all_user_sessions(user["id"])
        response.delete_cookie("arena_session")
        log_security_event("LOGOUT_ALL_SESSIONS", "success", f"User {user['username']} logged out of all sessions", ip=get_client_ip(request), user_id=user["id"])
        return {"ok": True, "message": "All sessions terminated"}

    @app.post("/api/auth/renew")
    async def auth_renew(request: Request):
        token = get_session_token(request)
        if not token or not renew_session(token):
            raise HTTPException(status_code=401, detail="Session expired or invalid")
        return {"ok": True}

    @app.post("/api/auth/change-password")
    async def auth_change_password(payload: ChangePasswordRequest, request: Request, user: Dict[str, Any] = Depends(get_current_user)):
        if user["id"] == "env-admin" or user["id"] == "anonymous-admin":
            raise HTTPException(status_code=400, detail="Cannot change password for environment admin. Update AGENT_AUTH_TOKEN in configuration.")

        with get_db() as conn:
            row = conn.execute("SELECT password_hash, salt FROM users WHERE id = ?", (user["id"],)).fetchone()
            if not row or not verify_password(payload.oldPassword, row["password_hash"], row["salt"]):
                raise HTTPException(status_code=400, detail="Incorrect current password")

            new_hash, new_salt = hash_password(payload.newPassword)
            conn.execute("UPDATE users SET password_hash = ?, salt = ?, updated_at = datetime('now') WHERE id = ?", (new_hash, new_salt, user["id"]))

        log_security_event("PASSWORD_CHANGED", "success", f"User {user['username']} changed password", ip=get_client_ip(request), user_id=user["id"])
        return {"ok": True, "message": "Password updated successfully"}

    @app.get("/api/auth/me")
    async def auth_me(user: Dict[str, Any] = Depends(get_current_user)):
        return {"user": user}

    # User Management (Admin Only)
    @app.get("/api/users")
    async def list_users(user: Dict[str, Any] = Depends(require_admin)):
        with get_db() as conn:
            rows = conn.execute("SELECT id, username, role, full_name, created_at, updated_at FROM users ORDER BY created_at ASC").fetchall()
            return {"users": [dict(r) for r in rows]}

    @app.post("/api/users")
    async def create_user(payload: CreateUserRequest, request: Request, user: Dict[str, Any] = Depends(require_admin)):
        if payload.role not in (ROLE_ADMIN, ROLE_DEVELOPER, ROLE_VIEWER):
            raise HTTPException(status_code=400, detail="Invalid role")
        pw_hash, salt = hash_password(payload.password)
        new_id = "user-" + secrets.token_hex(6)
        try:
            with get_db() as conn:
                conn.execute("""
                INSERT INTO users (id, username, password_hash, salt, role, full_name)
                VALUES (?, ?, ?, ?, ?, ?)
                """, (new_id, payload.username.strip(), pw_hash, salt, payload.role, payload.fullName or ""))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not create user: {str(e)}")

        log_security_event("USER_CREATED", "success", f"User {payload.username} created with role {payload.role}", ip=get_client_ip(request), user_id=user["id"])
        return {"ok": True, "id": new_id, "username": payload.username, "role": payload.role}

    @app.put("/api/users/{user_id}/role")
    async def update_user_role(user_id: str, payload: UpdateRoleRequest, request: Request, user: Dict[str, Any] = Depends(require_admin)):
        if payload.role not in (ROLE_ADMIN, ROLE_DEVELOPER, ROLE_VIEWER):
            raise HTTPException(status_code=400, detail="Invalid role")
        with get_db() as conn:
            conn.execute("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?", (payload.role, user_id))
        log_security_event("USER_ROLE_UPDATED", "success", f"User {user_id} role changed to {payload.role}", ip=get_client_ip(request), user_id=user["id"])
        return {"ok": True}

    @app.delete("/api/users/{user_id}")
    async def delete_user(user_id: str, request: Request, user: Dict[str, Any] = Depends(require_admin)):
        if user_id == user["id"]:
            raise HTTPException(status_code=400, detail="Cannot delete your own active account")
        with get_db() as conn:
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        log_security_event("USER_DELETED", "success", f"User {user_id} deleted", ip=get_client_ip(request), user_id=user["id"])
        return {"ok": True}

    @app.get("/api/security/logs")
    async def get_security_logs(limit: int = 100, user: Dict[str, Any] = Depends(require_admin)):
        with get_db() as conn:
            rows = conn.execute("SELECT id, timestamp, ip, user_id, event, status, details FROM security_logs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
            return {"logs": [dict(r) for r in rows]}
