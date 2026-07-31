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

# Recipients for the seven deferred notify_* functions — one env var per
# app.py recipient helper, same "comma-separated, falls back to a real
# address, never a placeholder" convention throughout.
APPROVAL_NOTIFY_EMAILS = os.environ.get("APPROVAL_NOTIFY_EMAILS", "")
APPROVAL_CC_EMAILS = os.environ.get("APPROVAL_CC_EMAILS", "")
SCHEDULER_NOTIFY_EMAILS = os.environ.get("SCHEDULER_NOTIFY_EMAILS", "")
# WAREHOUSE_NOTIFY_EMAILS / FINANCE_NOTIFY_EMAILS aren't in this task's
# named env var list, but _warehouse_recipients()/_finance_recipients()
# (app.py) each read their own real env var — added to match source,
# not omitted; flagged as a likely oversight in the task's list rather
# than silently left unconfigurable.
WAREHOUSE_NOTIFY_EMAILS = os.environ.get("WAREHOUSE_NOTIFY_EMAILS", "")
FINANCE_NOTIFY_EMAILS = os.environ.get("FINANCE_NOTIFY_EMAILS", "")

# Departmental-alert recipients — messaging.py's _department_recipients
# reads DEPT_EMAILS_{DEPARTMENT} dynamically; this app only ever has two
# real departments (PRESS/GARMENT, per is-garment.ts), so those are the
# two named constants rather than a dynamic os.environ lookup, matching
# this file's existing "named constant per env var" convention. Unlike
# every other recipient helper in this file, there is deliberately NO
# hardcoded fallback here — messaging.py's send_departmental_alert
# treats an unconfigured department as "don't send, log why" rather
# than guessing a real address, and that's preserved exactly.
DEPT_EMAILS_PRESS = os.environ.get("DEPT_EMAILS_PRESS", "")
DEPT_EMAILS_GARMENT = os.environ.get("DEPT_EMAILS_GARMENT", "")

# messaging.py's optional "Open Appointed Time Hub" link button in the
# departmental alert email. Not in this task's named env var list, but
# needed for that feature to actually appear — added and flagged
# rather than silently dropping the feature. Degrades gracefully like
# the source: an empty value just omits the button, same as source's
# own `if APP_URL else ""`.
APP_URL = os.environ.get("APP_URL", "")

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
