"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, hasRole } from "@/lib/nav-config";
import { formatLifecycleTimestamp } from "@/lib/lifecycle-timestamp";
import { buildMultiPartJobRecords, type ExistingJobFinish } from "./scheduling";

interface ActionResult {
  error?: string;
  recordCount?: number;
}

async function requireProductionLayoutAccess() {
  const user = await requireUser();
  if (!hasRole(user.role, ADMIN_ROLES)) {
    throw new Error("The Production Layout Builder is reserved for plant administrators.");
  }
  return user;
}

// Matches add_multi_part_job's tid = f"JOB-{datetime.now().strftime('%Y%m%d%H%M%S')}{random.randint(100, 999)}"
// exactly: second-resolution local timestamp + 3 random digits (100-999).
function generateTrackingId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(100 + Math.random() * 900);
  return `JOB-${ts}${rand}`;
}

// Matches add_multi_part_job's own anchor_start construction exactly:
// datetime.combine(start_date, datetime.now().time()).replace(tzinfo=timezone.utc)
// — the picked date's Y/M/D + the CURRENT wall-clock time-of-day,
// labeled UTC without converting.
//
// Computed SERVER-SIDE here, unlike Shop Floor's Operator Update (which
// combines client-side): Streamlit's datetime.now() always evaluates on
// the server — the whole script re-runs server-side on every
// interaction, there's no client-side JS in vanilla Streamlit — so for
// a scheduling-math path specifically, the faithful equivalent location
// for "now" is this Server Action, not the browser. (Operator Update's
// existing client-side implementation wasn't revisited here — it's
// already shipped and tested, and the few seconds of difference between
// click and server receipt don't matter for that path the way they
// could here.)
function combineDateWithNowAsUtc(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const now = new Date();
  return new Date(Date.UTC(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()));
}

interface CommitPlanInput {
  orderId: number;
  jobOrderNo: string;
  name: string;
  salesRep: string;
  startDate: string; // "YYYY-MM-DD"
  totalQty: number;
  typeId: number;
  totalVal: number;
  components: { machine: string; impressions: number }[];
  finishingMachines: string[];
}

// Mirrors add_multi_part_job (app.py:1330-1436) end to end: fetches the
// same machine-backlog snapshot get_machine_next_available_time reads
// elsewhere in this codebase, runs the ported scheduling engine
// (scheduling.ts — see scripts/verify-scheduling.ts for the standalone
// hand-verification this was confirmed against before being wired up),
// writes every resulting stage to `jobs`, then mirrors
// update_order_lifecycle_status(id, 'In Production') exactly like
// production-board/actions.ts's startProduction — replicated rather
// than imported, same reason as every other cross-route action in this
// project: importing it would revalidatePath("/production-board")
// instead of the routes that actually need to reflect this write.
export async function commitProductionPlan(input: CommitPlanInput): Promise<ActionResult> {
  await requireProductionLayoutAccess();

  const supabase = await createClient();

  // Same 72-hour-plus-all-future-dated window get_db_jobs() uses
  // elsewhere in this codebase (Shop Floor Control, Command Center) —
  // already established as safe for exactly this "does a machine have
  // future backlog" use case: excluding only long-past rows can never
  // change a max(finish_time) computation for any machine with real
  // upcoming work.
  const cutoff = new Date(Date.now() - 72 * 3_600_000).toISOString();
  const { data: backlogRows, error: backlogError } = await supabase
    .from("jobs")
    .select("machine, finish_time")
    .or(`finish_time.gte.${cutoff},finish_time.is.null`);

  if (backlogError) {
    return { error: backlogError.message };
  }
  const existingJobs: ExistingJobFinish[] = (backlogRows ?? []) as ExistingJobFinish[];

  const trackingId = generateTrackingId();
  const anchorStart = combineDateWithNowAsUtc(input.startDate);

  const records = buildMultiPartJobRecords(
    {
      name: input.name,
      jobOrderNo: input.jobOrderNo,
      salesRep: input.salesRep,
      totalQty: input.totalQty,
      typeId: input.typeId,
      totalVal: input.totalVal,
      components: input.components.map((c) => ({ machines: [c.machine], impressions: c.impressions })),
      finishingMachines: input.finishingMachines,
      anchorStart,
    },
    existingJobs,
    trackingId
  );

  // Single batched insert rather than the source's per-row loop
  // (`for r in records: supabase.table('jobs').insert(r).execute()`) —
  // identical end state on success, but a single multi-row INSERT is
  // strictly more atomic than N separate round trips, not less: a
  // reliability improvement, not a behavior change.
  const { error: insertError } = await supabase.from("jobs").insert(records);
  if (insertError) {
    return { error: `Database insertion failed: ${insertError.message}` };
  }

  const { error: statusError } = await supabase
    .from("job_orders")
    .update({
      status: "In Production",
      production_start_date: formatLifecycleTimestamp(new Date()),
    })
    .eq("id", input.orderId)
    .eq("status", "Approved");

  if (statusError) {
    return {
      error: `Jobs were scheduled (${records.length} stages), but updating the order's status failed: ${statusError.message}`,
    };
  }

  revalidatePath("/production-layout");
  revalidatePath("/production-board");
  revalidatePath("/shop-floor");

  return { recordCount: records.length };
}
