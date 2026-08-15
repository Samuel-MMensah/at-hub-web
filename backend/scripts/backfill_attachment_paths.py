"""
Operational migration script -- rewrites job_orders.lpo_file_url /
sample_file_url from a full Supabase Storage URL to the raw object PATH.

Context: the 'job-attachments' bucket was made private (see
MIGRATION_STATUS.md, "Security hardening pass"). New uploads now store
the raw object path and every consumer (approval email, Archive detail
view) mints a FRESH signed URL at use-time. Historical rows, however,
still held the old public URL from the getPublicUrl era -- dead once the
bucket went private. This script recovers the object path from each such
URL (strip the /object/public|sign/job-attachments/ prefix, URL-decode)
and rewrites the column to that path, restoring viewability through the
fresh-signing consumers.

Safe by construction:
  - IDEMPOTENT: a value already stored as a path (no leading "http") is
    left untouched, so re-running is a no-op.
  - VERIFIES existence: never rewrites to a path whose object isn't
    actually present in the bucket (checked via a throwaway signed-URL
    request, which errors on a missing object).
  - DRY-RUN by default: prints every before/after; only --apply writes.

First run: 2026-08-11 -- migrated 19 values across 18 rows (16
lpo_file_url + 3 sample_file_url; id 182 had both), all legacy public
URLs, all path-recoverable, all objects confirmed present. Kept as a
standing tool in case a similar migration is ever needed again.

    ./venv/Scripts/python.exe scripts/backfill_attachment_paths.py          # dry-run
    ./venv/Scripts/python.exe scripts/backfill_attachment_paths.py --apply  # write
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from urllib.parse import unquote

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.supabase_client import get_supabase

BUCKET = "job-attachments"
FIELDS = ("lpo_file_url", "sample_file_url")


def recover_path(value: str) -> str | None:
    """Object path from a stored value. A raw path (no leading http) is
    returned as-is; a full storage URL has its bucket prefix stripped and
    is URL-decoded; anything unrecognized returns None."""
    if not value or not value.startswith("http"):
        return value
    for marker in ("/object/public/job-attachments/", "/object/sign/job-attachments/"):
        i = value.find(marker)
        if i >= 0:
            return unquote(value[i + len(marker):].split("?")[0])
    return None


def main(apply: bool) -> None:
    supabase = get_supabase()
    storage = supabase.storage.from_(BUCKET)

    res = (
        supabase.table("job_orders")
        .select("id,job_order_no,lpo_file_url,sample_file_url")
        .or_("lpo_file_url.not.is.null,sample_file_url.not.is.null")
        .order("id")
        .execute()
    )

    changed = skipped = unrecoverable = 0
    for row in res.data:
        patch: dict[str, str] = {}
        for field in FIELDS:
            value = row.get(field)
            if not value:
                continue
            if not value.startswith("http"):
                skipped += 1  # already a raw path -- idempotent no-op
                continue
            path = recover_path(value)
            if not path:
                unrecoverable += 1
                print(f"  UNRECOVERABLE id={row['id']} {field}: {value[:80]}")
                continue
            # Confirm the object actually exists before rewriting to its path.
            try:
                storage.create_signed_url(path, 60)
            except Exception:
                unrecoverable += 1
                print(f"  OBJECT MISSING id={row['id']} {field}: {path}")
                continue
            patch[field] = path

        if patch:
            for field, new_value in patch.items():
                print(f"id={row['id']} {field}")
                print(f"   BEFORE: {row[field]}")
                print(f"   AFTER : {new_value}")
            if apply:
                supabase.table("job_orders").update(patch).eq("id", row["id"]).execute()
                print("   -> PATCHED")
            changed += len(patch)

    mode = "APPLIED" if apply else "DRY-RUN"
    print(f"\n{mode}: values to migrate={changed}, already-path={skipped}, unrecoverable={unrecoverable}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate legacy attachment URLs -> raw object paths.")
    parser.add_argument("--apply", action="store_true", help="Write changes (default: dry-run).")
    main(parser.parse_args().apply)
