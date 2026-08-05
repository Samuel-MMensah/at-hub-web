"""
One-time operational script -- regenerates a fresh recovery link and
resends the welcome email for EXISTING sales-rep accounts. Reuses the
exact same two real code paths create_guest_accounts.py's
provision_guest_account() already uses for this (generate_link +
send_account_welcome), just without the create_user() step -- these
are real, already-provisioned accounts, not new ones.

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
from app.email import send_account_welcome
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

    link_res = supabase.auth.admin.generate_link(
        {
            "type": "recovery",
            "email": email,
            "options": {"redirect_to": RESET_PASSWORD_REDIRECT},
        }
    )
    action_link = link_res.properties.action_link

    sent = send_account_welcome(recipient_email=email, recipient_name=full_name, reset_link=action_link)

    return {
        "email": email,
        "action_link": action_link,
        "verification_type": link_res.properties.verification_type,
        "redirect_to": link_res.properties.redirect_to,
        "email_sent": sent,
    }


def main() -> None:
    print(f"=== Resending welcome email to {len(RECIPIENTS)} existing sales-rep accounts ===\n")
    results = []
    for full_name, email in RECIPIENTS:
        print(f"--- {full_name} ({email}) ---")
        result = resend_welcome(full_name, email)
        results.append((full_name, result))
        print(f"  link well-formed: {result['action_link'].startswith('http')}")
        print(f"  redirect_to correct: {result['redirect_to'] == RESET_PASSWORD_REDIRECT}")
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
