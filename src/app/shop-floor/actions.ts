"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { parseTimestamptz } from "@/lib/parse-timestamptz";

interface ActionResult {
  error?: string;
}

const STAGE_STATUS_OPTIONS = ["In Progress", "Delayed", "On Hold", "Complete"] as const;
type StageStatus = (typeof STAGE_STATUS_OPTIONS)[number];

interface JobStageRow {
  tracking_id: string;
  job_order_no: string | null;
  sequence_no: number | null;
  planned_finish: string | null;
  revised_finish: string | null;
  revised_start: string | null;
  planned_start: string | null;
  stage_status: string | null;
}

// Faithful port of update_stage_status() (app.py:1437-1492) — the
// highest-risk write in this app. It doesn't just update one stage's
// status: pushing or pulling a stage's finish time can cascade a shift
// onto every downstream, not-yet-complete sibling stage in the same
// order. No role gate — matches Shop Floor Control's own page (any
// authenticated user), same as the source's Operator Update expander.
//
// revisedFinishIso is the caller's already-combined "picked date +
// current wall-clock time, labeled UTC" instant (see
// combineDateWithNowAsUtc in shop-floor-client.tsx) — this function
// takes it as given, exactly like the Python function takes
// revised_finish as a parameter rather than computing it itself.
export async function updateStageStatus(
  trackingId: string,
  newStatus: StageStatus,
  revisedFinishIso: string | null
): Promise<ActionResult> {
  await requireUser();

  if (!trackingId) {
    return { error: "No stage selected." };
  }
  if (!STAGE_STATUS_OPTIONS.includes(newStatus)) {
    return { error: `Invalid status "${newStatus}".` };
  }

  const supabase = await createClient();

  const { data: rows, error: fetchError } = await supabase
    .from("jobs")
    .select(
      "tracking_id, job_order_no, sequence_no, planned_finish, revised_finish, revised_start, planned_start, stage_status"
    )
    .eq("tracking_id", trackingId)
    .limit(1);

  if (fetchError) return { error: fetchError.message };
  const row = rows?.[0] as JobStageRow | undefined;
  if (!row) return { error: `No job stage found for tracking_id="${trackingId}".` };

  // "Complete with no explicit revised_finish" defaults to now — dead in
  // practice via this UI (the client always supplies one for Delayed/
  // Complete), kept for fidelity since the source function is general
  // purpose, not written only for this one form.
  let revisedFinish = revisedFinishIso ? new Date(revisedFinishIso) : null;
  if (newStatus === "Complete" && revisedFinish === null) {
    revisedFinish = new Date();
  }

  const updates: Record<string, string> = { stage_status: newStatus };
  if (revisedFinish !== null) {
    updates.revised_finish = revisedFinish.toISOString();
    if (newStatus === "Complete") {
      updates.actual_finish = revisedFinish.toISOString();
    }
  }

  const { error: updateError } = await supabase.from("jobs").update(updates).eq("tracking_id", trackingId);
  if (updateError) return { error: updateError.message };

  // Revalidate as soon as the primary write lands — everything after
  // this point is the cascade, which may legitimately no-op (early
  // returns below), but the page must reflect the primary write either way.
  revalidatePath("/shop-floor");

  if (revisedFinish === null || row.sequence_no === null || !row.job_order_no) {
    return {};
  }

  // Delta is measured against THIS stage's own planned_finish — the
  // immutable baseline — not its current revised_finish. Get this
  // reference point wrong and every downstream shift is wrong too.
  const baseline = row.planned_finish;
  if (!baseline) {
    return {};
  }

  const deltaSeconds = (revisedFinish.getTime() - parseTimestamptz(baseline).getTime()) / 1000;
  if (Math.abs(deltaSeconds) < 60) {
    return {};
  }

  const { data: siblings, error: sibError } = await supabase
    .from("jobs")
    .select("tracking_id, planned_start, revised_start, revised_finish, planned_finish, stage_status")
    .eq("job_order_no", row.job_order_no)
    .gt("sequence_no", row.sequence_no)
    .neq("stage_status", "Complete");

  if (sibError) return { error: sibError.message };

  for (const sib of siblings ?? []) {
    const sibUpdate: Record<string, string> = {};

    const baseFinish = sib.revised_finish ?? sib.planned_finish;
    if (baseFinish) {
      sibUpdate.revised_finish = new Date(
        parseTimestamptz(baseFinish).getTime() + deltaSeconds * 1000
      ).toISOString();
    }

    if (sib.stage_status === "Scheduled") {
      const baseStart = sib.revised_start ?? sib.planned_start;
      if (baseStart) {
        sibUpdate.revised_start = new Date(
          parseTimestamptz(baseStart).getTime() + deltaSeconds * 1000
        ).toISOString();
      }
    }

    // Only a push (delta > 0) flips siblings to Delayed. A pull (delta <
    // 0, schedule moved earlier) only shifts dates, status is untouched.
    if (deltaSeconds > 0) {
      sibUpdate.stage_status = "Delayed";
    }

    if (Object.keys(sibUpdate).length > 0) {
      const { error: sibUpdateError } = await supabase
        .from("jobs")
        .update(sibUpdate)
        .eq("tracking_id", sib.tracking_id);
      if (sibUpdateError) return { error: sibUpdateError.message };
    }
  }

  return {};
}
