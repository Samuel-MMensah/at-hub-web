"""
Session verification for backend endpoints. Uses the anon-key client
(not service-role) to validate a caller's session token via
auth.get_user(token) — this only checks "is this a real, current
Supabase session," it grants no elevated DB access on its own. The
actual data read still goes through the service-role client in
supabase_client.py, separately, after this check passes.

require_user() is a FastAPI dependency: any authenticated user passes,
no role check — matching job_orders' existing RLS posture (SELECT is
`roles: {authenticated}, qual: true`, deliberately broad, not
role-restricted; see MIGRATION_STATUS.md). This endpoint doesn't expose
anything beyond what any authenticated user can already read directly.
"""
from __future__ import annotations

from fastapi import Header, HTTPException
from supabase import Client, create_client

from app.config import SUPABASE_ANON_KEY, SUPABASE_URL

_anon_client: Client | None = None


def get_anon_supabase() -> Client:
    global _anon_client
    if _anon_client is None:
        if not SUPABASE_URL or not SUPABASE_ANON_KEY:
            raise RuntimeError(
                "SUPABASE_URL / SUPABASE_ANON_KEY not set — "
                "add SUPABASE_ANON_KEY to backend/.env."
            )
        _anon_client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    return _anon_client


def require_user(authorization: str | None = Header(default=None)):
    """Raises 401 before the route body runs unless Authorization is a
    valid 'Bearer <token>' for a real, current Supabase session."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")

    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token.")

    supabase = get_anon_supabase()
    try:
        result = supabase.auth.get_user(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired session.")

    if not result or not result.user:
        raise HTTPException(status_code=401, detail="Invalid or expired session.")

    return result.user
