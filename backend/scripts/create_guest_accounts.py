"""
One-time operational script, not an app feature -- creates real
Supabase Auth accounts for sales-rep staff who need Guest-role access
(Command Center / Production Board / Shop Floor Control / Audit Log --
the only routes with no role gate; every other route already requires
a role Guest doesn't have, so no RLS/code change was needed for this).

Invite-link onboarding, not shared passwords: each account gets a
random throwaway password (never logged, never displayed, immediately
discarded -- nothing after create_user() ever reads `password` back
out), then a one-time Supabase recovery link is generated and emailed
via app.email.send_account_welcome() so the person sets their own
password on first login.

Two separate modes, run as two separate invocations on purpose --
this file deliberately does NOT auto-cascade from dry-run into the
real 5-person run. Proving the flow and touching real, permanent
accounts are kept as two distinct, manually-gated steps:

    ./venv/Scripts/python.exe scripts/create_guest_accounts.py --dry-run
    ./venv/Scripts/python.exe scripts/create_guest_accounts.py --real

--dry-run: provisions ONE throwaway account (delivered@resend.dev --
Resend's own documented always-succeeds test address, chosen so the
real send path is genuinely exercised without depending on a mailbox
nobody here can check), verifies every step, then deletes the auth
user and confirms the profiles row is gone too (FK cascade, same as
verified in the Phase 4/RLS work -- see MIGRATION_STATUS.md).

--real: provisions the 5 real, permanent accounts listed in
GUEST_ACCOUNTS below. No cleanup after -- these are meant to stay.
Only run this after a --dry-run has passed clean.
"""
from __future__ import annotations

import logging
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.email import send_account_welcome
from app.supabase_client import get_supabase

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

# Real, confirmed-live production URL (verified via curl before this
# was ever wired in -- backend/.env's APP_URL is unset, and this isn't
# guessed from DEPLOYMENT.md's illustrative example). Without an
# explicit redirect_to, generate_link() falls back to the Supabase
# project's configured Site URL, which is still http://localhost:3000
# -- confirmed live during this task's own dry run, not assumed.
PRODUCTION_URL = "https://hub.appointedtimeprinting.com"
RESET_PASSWORD_REDIRECT = f"{PRODUCTION_URL}/reset-password"

# Real, permanent accounts for Step 4 -- confirmed by name+email against
# this backend's own existing SALES_REP_EMAILS (app/email.py) before
# writing this list, not retyped independently.
GUEST_ACCOUNTS: list[tuple[str, str]] = [
    ("Charles Adoo", "charles.adoo@appointedtime.com.gh"),
    ("Daphne Sarpong", "d.sarpong@appointedtime.com.gh"),
    ("Elizabeth Addo Obeng", "ea.obeng@appointedtime.com.gh"),
    ("Reginald Aidam", "reginald.aidam@appointedtime.com.gh"),
    ("Mabel Ampofo", "mabel.ampofo@appointedtime.com.gh"),
]


def provision_guest_account(full_name: str, email: str) -> dict:
    """
    The one real code path used by BOTH modes -- the dry run proves
    exactly this function, not a simplified stand-in for it.

    1. Create the Auth user (random throwaway password, discarded
       immediately -- never assigned to a variable that outlives this
       call, never logged).
    2. Creating the Auth user auto-triggers a profiles row defaulting
       to full_name="New Staff", role="Front Desk" (Phase 4's
       incidental discovery, re-confirmed live here) -- PATCH it with
       the real name/role/department right after.
    3. Generate a one-time recovery link (type="recovery") -- this is
       what makes it invite-link onboarding rather than a shared
       password: the account has no password anyone here ever knew.
    4. Email it via send_account_welcome().
    """
    supabase = get_supabase()

    throwaway_password = secrets.token_urlsafe(24)
    created = supabase.auth.admin.create_user(
        {
            "email": email,
            "password": throwaway_password,
            "email_confirm": True,
        }
    )
    del throwaway_password  # never read again; not returned, not logged
    user_id = created.user.id
    logger.info("Auth user created: id=%s email=%s", user_id, email)

    profile_patch = (
        supabase.table("profiles")
        .update({"full_name": full_name, "role": "Guest", "department": "NONE"})
        .eq("id", user_id)
        .execute()
    )
    if not profile_patch.data:
        raise RuntimeError(
            f"profiles row for {user_id} ({email}) was not found to patch -- "
            "the auto-create trigger may not have fired as expected."
        )
    profile_row = profile_patch.data[0]
    logger.info("Profile row patched: %s", profile_row)

    link_res = supabase.auth.admin.generate_link(
        {
            "type": "recovery",
            "email": email,
            "options": {"redirect_to": RESET_PASSWORD_REDIRECT},
        }
    )
    action_link = link_res.properties.action_link
    logger.info(
        "Recovery link generated: verification_type=%s redirect_to=%s link_len=%d",
        link_res.properties.verification_type,
        link_res.properties.redirect_to,
        len(action_link),
    )

    sent = send_account_welcome(recipient_email=email, recipient_name=full_name, reset_link=action_link)
    logger.info("Welcome email sent=%s to=%s", sent, email)

    return {
        "user_id": user_id,
        "email": email,
        "profile": profile_row,
        "action_link": action_link,
        "link_properties": link_res.properties,
        "email_sent": sent,
    }


def run_dry_run() -> None:
    supabase = get_supabase()
    test_name = "TEST - DO NOT SHIP (Guest Onboarding Dry Run)"
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
    print(f"  expected redirect_to: {RESET_PASSWORD_REDIRECT}")
    print(f"  action_link: {link}")
    print(f"  hashed_token present: {bool(props.hashed_token)}")
    print(f"  redirect_to: {props.redirect_to}")

    print(f"Welcome email accepted by Resend: {result['email_sent']}")

    print("\n--- Cleanup ---")
    supabase.auth.admin.delete_user(result["user_id"])
    print(f"Deleted auth user {result['user_id']}")

    # Re-fetch independently rather than trust the delete call's own
    # success -- same discipline as every prior disposable-account test
    # in this project.
    remaining_profile = supabase.table("profiles").select("id").eq("id", result["user_id"]).execute()
    print(f"Profile row remaining after delete (expect empty): {remaining_profile.data}")

    all_ok = profile_ok and link_ok and result["email_sent"] and not remaining_profile.data
    print(f"\n=== DRY RUN {'PASSED' if all_ok else 'FAILED'} ===")
    if not all_ok:
        sys.exit(1)


def run_real() -> None:
    print(f"=== REAL RUN: provisioning {len(GUEST_ACCOUNTS)} permanent accounts ===")
    print("No cleanup will happen after this. Ctrl+C now to abort.\n")

    results = []
    for full_name, email in GUEST_ACCOUNTS:
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
        print("Usage: create_guest_accounts.py [--dry-run | --real]")
        sys.exit(1)
