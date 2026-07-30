"""
Central config loader. Mirrors messaging.py's _config() pattern (single
function, defined priority) but simpler: this service always runs
somewhere real env vars are set (Render), so no st.secrets fallback is
needed — just os.environ, with python-dotenv populating it from a local
.env file during development only.
"""
from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()  # no-op in production if no .env file is present — Render
                # sets real env vars directly, this only helps local dev

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
# Anon/public key — same value as the frontend's NEXT_PUBLIC_SUPABASE_ANON_KEY,
# not a secret. Used only to verify a caller's session token
# (auth.get_user(token)) before generating a PDF; the actual DB read
# still goes through the service-role client above.
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
RESEND_SENDER_EMAIL = os.environ.get("RESEND_SENDER_EMAIL", "onboarding@resend.dev")

# Collection-alert recipients — mirrors app.py's _collection_alert_recipients:
# two slots, each may itself be a comma-separated list.
NOTIFY_EMAIL_1 = os.environ.get("NOTIFY_EMAIL_1", "")
NOTIFY_EMAIL_2 = os.environ.get("NOTIFY_EMAIL_2", "")

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
