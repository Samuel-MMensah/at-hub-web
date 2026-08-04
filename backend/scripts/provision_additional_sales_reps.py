"""
One-time operational script, not an app feature -- same purpose and
exact same underlying provision_guest_account() as
create_guest_accounts.py, run again for two more real sales reps
discovered missing from `profiles` while migrating SALES_REP_NAMES to
a live, profiles-driven source (is_sales_rep column).

Deliberately NOT added to create_guest_accounts.py's own
GUEST_ACCOUNTS list -- that list documents the 5-person batch that
already ran and is meant to stay a historical record of that
completed run, not be silently re-triggered. This is its own separate,
smaller batch, same two-mode safety gate (dry-run must pass before
real):

    ./venv/Scripts/python.exe scripts/provision_additional_sales_reps.py --dry-run
    ./venv/Scripts/python.exe scripts/provision_additional_sales_reps.py --real

Emails confirmed against backend/app/email.py's own SALES_REP_EMAILS
dict, not retyped independently. A third name in that same dict,
"Mohammed Seidu Bunyamin" (m.seidu@appointedtime.com.gh), is NOT here
-- that email already belongs to an existing profile ("Mohammed
Seidu", Front Desk role), confirmed to be the same person. That one is
handled as a rename + is_sales_rep flag on the existing row, not a new
account (see the accompanying SQL for this task).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from create_guest_accounts import RESET_PASSWORD_REDIRECT, provision_guest_account
from app.supabase_client import get_supabase

NEW_SALES_REP_ACCOUNTS: list[tuple[str, str]] = [
    ("Isaac Kum", "isaac.kum@appointedtime.com.gh"),
    ("Christian Mante", "christian.mante@appointedtime.com.gh"),
]


def run_dry_run() -> None:
    supabase = get_supabase()
    test_name = "TEST - DO NOT SHIP (Additional Sales Rep Onboarding Dry Run)"
    test_email = "delivered@resend.dev"

    print("=== DRY RUN: provisioning one throwaway account ===")
    result = provision_guest_account(test_name, test_email)

    print("\n--- Verification ---")
    profile = result["profile"]
    profile_ok = (
        profile.get("full_name") == test_name
        and profile.get("role") == "Guest"
        and profile.get("department") == "NONE"
    )
    print(f"Profile correct (full_name/role=Guest/department=NONE): {profile_ok}")
    print(f"  actual: {profile}")

    link = result["action_link"]
    props = result["link_properties"]
    link_ok = (
        link.startswith("http")
        and "type=recovery" in link
        and props.verification_type == "recovery"
        and bool(props.hashed_token)
        and props.redirect_to == RESET_PASSWORD_REDIRECT
    )
    print(f"Recovery link well-formed AND points at the real production reset page: {link_ok}")
    print(f"  action_link: {link}")

    print(f"Welcome email accepted by Resend: {result['email_sent']}")

    print("\n--- Cleanup ---")
    supabase.auth.admin.delete_user(result["user_id"])
    print(f"Deleted auth user {result['user_id']}")

    remaining_profile = supabase.table("profiles").select("id").eq("id", result["user_id"]).execute()
    print(f"Profile row remaining after delete (expect empty): {remaining_profile.data}")

    all_ok = profile_ok and link_ok and result["email_sent"] and not remaining_profile.data
    print(f"\n=== DRY RUN {'PASSED' if all_ok else 'FAILED'} ===")
    if not all_ok:
        sys.exit(1)


def run_real() -> None:
    print(f"=== REAL RUN: provisioning {len(NEW_SALES_REP_ACCOUNTS)} permanent accounts ===")
    print("No cleanup will happen after this. Ctrl+C now to abort.\n")

    results = []
    for full_name, email in NEW_SALES_REP_ACCOUNTS:
        print(f"--- {full_name} ({email}) ---")
        result = provision_guest_account(full_name, email)
        results.append(result)
        print(f"  user_id: {result['user_id']}")
        print(f"  profile: {result['profile']}")
        print(f"  email_sent: {result['email_sent']}")
        print()

    print("=== SUMMARY ===")
    for r in results:
        print(f"{r['profile']['full_name']:<24} {r['email']:<38} id={r['user_id']} sent={r['email_sent']}")


if __name__ == "__main__":
    if "--dry-run" in sys.argv:
        run_dry_run()
    elif "--real" in sys.argv:
        run_real()
    else:
        print("Usage: provision_additional_sales_reps.py [--dry-run | --real]")
        sys.exit(1)
