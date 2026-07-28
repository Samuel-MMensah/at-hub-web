"""
Service-role Supabase client for this backend only. Never import this
pattern into the Next.js app — the service role key bypasses RLS
entirely, which is correct for a trusted backend job (e.g. "attach this
order's PDF and email it") but would be a serious hole if it ever ran
somewhere a browser could reach it.
"""
from supabase import create_client, Client

from app.config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

_client: Client | None = None


def get_supabase() -> Client:
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
            raise RuntimeError(
                "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — "
                "copy backend/.env.example to backend/.env and fill them in."
            )
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    return _client
