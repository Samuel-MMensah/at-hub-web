"""
One-time operational script -- regenerates a fresh recovery code and
resends the welcome email for EXISTING sales-rep accounts. Reuses
generate_link() from create_guest_accounts.py's provision_guest_account()
for the token itself, but delivers it via send_account_welcome_with_code
(a pasted code, not a clickable link) -- see that function's own
docstring in backend/app/email.py for why: generate_link()'s
`redirect_to` was found to be silently truncated by Supabase, making
the clickable-link delivery unreliable in production (confirmed live,
reproduced three times, even after the redirect URL was added to the
project's allowlist). The code-based path sidesteps that entirely: no
redirect_to-derived URL anywhere in the email.

Scoped deliberately to the 7 Guest-role sales reps whose ONLY access is
this account (per explicit instruction) -- NOT the 3 dual-role reps
(Bertha Tackie, Jacqueline Afful, Mohammed Seidu Bunyamin) who already
actively use their Front Desk/md logins day to day and would find an
unsolicited "Welcome" + password-reset email out of place.

    ./venv/Scripts/python.exe scripts/resend_sales_rep_welcome.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from create_guest_accounts import RESET_PASSWORD_REDIRECT
from app.email import send_account_welcome_with_code
from app.supabase_client import get_supabase

# Confirmed live against profiles (is_sales_rep=true, role=Guest) right
# before writing this -- not retyped from memory.
RECIPIENTS: list[tuple[str, str]] = [
    ("Charles Adoo", "charles.adoo@appointedtime.com.gh"),
    ("Christian Mante", "christian.mante@appointedtime.com.gh"),
    ("Daphne Sarpong", "d.sarpong@appointedtime.com.gh"),
    ("Elizabeth Addo Obeng", "ea.obeng@appointedtime.com.gh"),
    ("Isaac Kum", "isaac.kum@appointedtime.com.gh"),
    ("Mabel Ampofo", "mabel.ampofo@appointedtime.com.gh"),
    ("Reginald Aidam", "reginald.aidam@appointedtime.com.gh"),
]


def resend_welcome(full_name: str, email: str) -> dict:
    supabase = get_supabase()

    # redirect_to is still passed (harmless, unused by the code-based
    # flow) purely so generate_link()'s request shape matches every
    # other call site in this codebase -- the value it comes back
    # truncated to is irrelevant here since action_link/redirect_to are
    # never used below, only hashed_token is.
    link_res = supabase.auth.admin.generate_link(
        {
            "type": "recovery",
            "email": email,
            "options": {"redirect_to": RESET_PASSWORD_REDIRECT},
        }
    )
    code = link_res.properties.hashed_token

    sent = send_account_welcome_with_code(recipient_email=email, recipient_name=full_name, code=code)

    return {
        "email": email,
        "code": code,
        "email_sent": sent,
    }


def main() -> None:
    print(f"=== Resending welcome email (code-based) to {len(RECIPIENTS)} existing sales-rep accounts ===\n")
    results = []
    for full_name, email in RECIPIENTS:
        print(f"--- {full_name} ({email}) ---")
        result = resend_welcome(full_name, email)
        results.append((full_name, result))
        print(f"  code issued: {bool(result['code'])}")
        print(f"  email_sent: {result['email_sent']}")
        print()

    print("=== SUMMARY ===")
    for full_name, result in results:
        print(f"{full_name:<24} {result['email']:<38} sent={result['email_sent']}")

    if not all(r["email_sent"] for _, r in results):
        print("\nAt least one send failed -- see the errors logged above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
