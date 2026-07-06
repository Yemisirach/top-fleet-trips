import base64
import asyncio
import hashlib
import hmac
import json
import os
from pathlib import Path
import time
from typing import Optional
import xmlrpc.client

import asyncpg
import bcrypt

from fastapi import Cookie, Depends, HTTPException, Request
from jose import jwt, JWTError

from app.core.settings import get_settings


AUTH_COOKIE_NAME = "fleet_auth"

def _config_value(key: str, default: str) -> str:
    # First try env var, then .env file, then default
    env_val = os.getenv(key)
    if env_val:
        return env_val
    env_path = Path(__file__).resolve().parents[3] / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
                continue
            env_key, value = line.split("=", 1)
            if env_key.strip() == key:
                return value.strip().strip('"').strip("'")
    return default


AUTH_SESSION_SECONDS = int(_config_value("FLEET_AUTH_SESSION_SECONDS", str(12 * 60 * 60)))
AUTH_SECRET = _config_value("FLEET_AUTH_SECRET", "").strip()

# Security: crash on startup if secret not set or is default
if not AUTH_SECRET or AUTH_SECRET == "change-this-fleet-auth-secret":
    raise RuntimeError(
        "FLEET_AUTH_SECRET must be set to a strong random secret. "
        "Generate one with: openssl rand -base64 32"
    )


# Load users from environment; passwords MUST be bcrypt hashed externally.
# Example env: FLEET_USERS=danat.yoh:$2b$12$...,alula.yem:$2b$12$...
# Falls back to known insecure dev defaults ONLY if FLEET_INSECURE_DEV=1
_USERS_RAW = _config_value("FLEET_USERS", "")
USERS = {}
if _USERS_RAW:
    for entry in _USERS_RAW.split(","):
        entry = entry.strip()
        if ":" in entry:
            u, p = entry.split(":", 1)
            USERS[u.strip().lower()] = {"username": u.strip(), "password": p.strip()}
elif os.getenv("FLEET_INSECURE_DEV") == "1":
    import warnings
    warnings.warn(
        "FLEET_INSECURE_DEV is set. Using insecure plaintext dev passwords. "
        "NEVER use this in production.",
        stacklevel=2,
    )
    # Insecure dev fallbacks
    USERS = {
        "danat.yoh": {"username": "danat.yoh", "password": "**REDACTED**", "role": "manager", "name": "Manager"},
        "alula.yem": {"username": "alula.yem", "password": "**REDACTED**", "role": "supervisor", "name": "Supervisor"},
        "barbra.sem": {"username": "barbra.sem", "password": "**REDACTED**", "role": "salesperson", "name": "Salesperson"},
    }
else:
    raise RuntimeError(
        "FLEET_USERS env var not set and FLEET_INSECURE_DEV is disabled. "
        "Set FLEET_USERS or run with FLEET_INSECURE_DEV=1 for local dev only."
    )

ROLE_BY_LOGIN = {
    "danat.yoh": "manager",
    "alula.yem": "supervisor",
    "barbra.sem": "salesperson",
}


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def _hash_password(password: str) -> str:
    """Hash a plaintext password using bcrypt."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_password(password: str, hashed: str) -> bool:
    """Verify a plaintext password against a bcrypt hash."""
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


def public_user(user: dict) -> dict:
    return {
        "username": user["username"],
        "name": user["name"],
        "role": user["role"],
        "auth_source": user.get("auth_source", "app"),
        "odoo_user_id": user.get("odoo_user_id"),
    }


def _database_name_from_url(url: str) -> str:
    return (url or "").rstrip("/").rsplit("/", 1)[-1] or "Testbed"


def _role_from_groups(login: str, group_names: list[str]) -> str:
    groups = " ".join(group_names or []).lower()
    if "manager" in groups or "administrator" in groups or "admin" in groups:
        return "manager"
    if "supervisor" in groups:
        return "supervisor"
    if "sales" in groups or "salesperson" in groups:
        return "salesperson"
    return ROLE_BY_LOGIN.get((login or "").lower(), "salesperson")


async def _odoo_user_from_db(username: str) -> Optional[dict]:
    settings = get_settings()
    db_url = (settings.odoo_database_url or settings.database_url).replace("+asyncpg", "")
    if not db_url:
        return None
    conn = None
    try:
        lookup_timeout = settings.odoo_role_lookup_timeout_seconds
        conn = await asyncpg.connect(db_url, timeout=lookup_timeout)
        row = await conn.fetchrow(
            """
            SELECT
                u.id,
                u.login,
                COALESCE(p.name, u.login) AS name,
                COALESCE(u.active, true) AS active,
                COALESCE(array_agg(g.name::text) FILTER (WHERE g.id IS NOT NULL), ARRAY[]::text[]) AS groups
            FROM res_users u
            LEFT JOIN res_partner p ON u.partner_id = p.id
            LEFT JOIN res_groups_users_rel rel ON rel.uid = u.id
            LEFT JOIN res_groups g ON g.id = rel.gid
            WHERE lower(u.login) = lower($1)
            GROUP BY u.id, u.login, p.name, u.active
            """,
            username,
            timeout=lookup_timeout,
        )
    except Exception:
        return None
    finally:
        if conn:
            await conn.close()
    if not row or not row["active"]:
        return None
    groups = list(row["groups"] or [])
    return {
        "username": row["login"],
        "name": row["name"],
        "role": _role_from_groups(row["login"], groups),
        "groups": groups,
        "odoo_user_id": row["id"],
        "auth_source": "odoo",
    }


def _authenticate_odoo_xmlrpc(username: str, password: str) -> Optional[int]:
    settings = get_settings()
    if not settings.odoo_url:
        return None
    db_name = settings.odoo_db or _database_name_from_url(settings.odoo_database_url)
    common = xmlrpc.client.ServerProxy(f"{settings.odoo_url.rstrip('/')}/xmlrpc/2/common", allow_none=True)
    uid = common.authenticate(db_name, username, password, {})
    return int(uid) if uid else None


# Back-compat: sign custom tokens with HMAC (used for cookie tokens, not JWT)
def _sign(payload: str) -> str:
    return hmac.new(AUTH_SECRET.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def create_token(user: dict) -> str:
    """Create a compact signed token (HMAC-based). For standard JWT use create_jwt_token."""
    payload = {
        "username": user["username"],
        "role": user["role"],
        "name": user["name"],
        "auth_source": user.get("auth_source", "app"),
        "odoo_user_id": user.get("odoo_user_id"),
        "exp": int(time.time()) + AUTH_SESSION_SECONDS,
    }
    encoded_payload = _b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    return f"{encoded_payload}.{_sign(encoded_payload)}"


def verify_token(token: str) -> Optional[dict]:
    try:
        encoded_payload, signature = token.split(".", 1)
        if not hmac.compare_digest(signature, _sign(encoded_payload)):
            return None
        payload = json.loads(_b64decode(encoded_payload))
    except Exception:
        return None
    if int(payload.get("exp", 0)) < int(time.time()):
        return None
    if not payload.get("username") or not payload.get("role"):
        return None
    return public_user(payload)


def user_from_request(request: Request) -> Optional[dict]:
    token = request.cookies.get(AUTH_COOKIE_NAME)
    if not token:
        return None
    return verify_token(token)


async def require_user(fleet_auth: Optional[str] = Cookie(default=None)) -> dict:
    user = verify_token(fleet_auth or "")
    if not user:
        raise HTTPException(status_code=401, detail="Login required")
    return user


async def require_manager(user: dict = Depends(require_user)) -> dict:
    if user.get("role") != "manager":
        raise HTTPException(status_code=403, detail="Only managers can approve or update payment requests")
    return user


async def authenticate(username: str, password: str) -> Optional[dict]:
    login = (username or "").strip().lower()
    if not login or not password:
        return None

    odoo_uid = None
    try:
        odoo_uid = await asyncio.wait_for(
            asyncio.to_thread(_authenticate_odoo_xmlrpc, login, password),
            timeout=get_settings().odoo_role_lookup_timeout_seconds,
        )
    except Exception:
        odoo_uid = None
    if odoo_uid:
        odoo_user = await _odoo_user_from_db(login)
        if odoo_user:
            odoo_user["odoo_user_id"] = odoo_uid
            odoo_user["auth_source"] = "odoo"
            return odoo_user
        return {
            "username": login,
            "name": login,
            "role": ROLE_BY_LOGIN.get(login, "salesperson"),
            "odoo_user_id": odoo_uid,
            "auth_source": "odoo",
        }

    # App login: check bcrypt hashed password
    user = USERS.get(login)
    if user:
        # Allow either bcrypt hash or plaintext (plaintext only for dev/insecure mode)
        stored = user["password"]
        valid = False
        if stored.startswith("$2b$") or stored.startswith("$2a$"):
            valid = _verify_password(password, stored)
        else:
            valid = hmac.compare_digest(str(user["password"]), str(password))
        if not valid:
            return None

    if not user:
        return None

    odoo_user = await _odoo_user_from_db(login)
    if odoo_user:
        odoo_user["auth_source"] = "app+odoo-role"
        return odoo_user
    return {**user, "auth_source": "app"}
