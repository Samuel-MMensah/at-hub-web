// Ports the real scheduling engine from app.py: apply_calendar_bounds
// (1261-1269), _next_working_day_start (1271-1284),
// get_machine_next_available_time (1286-1303), calculate_production_time
// (1305-1328), add_multi_part_job (1330-1436).
//
// Deliberately pure / framework-agnostic: no Supabase, no "use client" /
// "use server", no calls to Date.now() or Math.random() anywhere in
// this file. Every function takes whatever "now"-derived values it
// needs (anchorStart, trackingId, existingJobs) as explicit parameters,
// so the whole engine is deterministic and testable without a database
// or a browser — see scripts/verify-scheduling.ts for the standalone
// hand-verification harness this was built for.
//
// All dates are treated as naive-then-labeled-UTC throughout, matching
// this codebase's established convention (see
// combineDateWithNowAsUtc in shop-floor-client.tsx for the same
// pattern): callers build the initial anchor via Date.UTC(...) using
// literal Y/M/D + wall-clock H/M/S digits, and every function here
// operates on those digits via the UTC getters/setters, never the
// local-timezone ones.
import { parseTimestamptz } from "../../lib/parse-timestamptz";

export const SHIFT_START_HOUR = 8;
export const SHIFT_END_HOUR = 17;
export const STAGE_DAYS_WARNING_THRESHOLD = 30; // working days (~6 calendar weeks)

export interface MachineSpec {
  rate: number;
  setupHours: number;
}

// Ports MACHINE_DATA (app.py:142-160) verbatim — same table Phase 1's
// pre-flight check already uses, re-declared here rather than imported
// from production-layout-client.tsx since this module must stay
// import-clean of any "use client" file (a plain script can't load a
// Client Component module).
export const MACHINE_DATA: Record<string, MachineSpec> = {
  "SM102-CX FOUR COLOUR": { rate: 8000, setupHours: 1.5 },
  "SM102-P FIVE COLOUR": { rate: 7500, setupHours: 1.5 },
  "SM 52": { rate: 7000, setupHours: 1.5 },
  "GTO 52 SEMI-AUTO-2 COLOUR": { rate: 4500, setupHours: 1.5 },
  "GTO 52 MANUAL-2 COLOUR": { rate: 4000, setupHours: 2.0 },
  "FOLDING UNIT CONTINUOUS FOLD": { rate: 8000, setupHours: 1.5 },
  "MBO-B30E SINGLE FOLD": { rate: 16000, setupHours: 1.5 },
  "POLAR MACHINE FOR BOOKS": { rate: 2000, setupHours: 1.0 },
  "POLAR MACHINE FOR SHEETS": { rate: 50000, setupHours: 1.0 },
  "3 WAY TRIMMER": { rate: 5000, setupHours: 1.0 },
  "PERFECT BINDING": { rate: 500, setupHours: 1.5 },
  "LAMINATION UNIT": { rate: 2500, setupHours: 1.5 },
  "PEDDLER SADDLE STITCH": { rate: 1000, setupHours: 1.5 },
  "DIE CUTTER": { rate: 3000, setupHours: 1.5 },
  "FOLDER GLUER": { rate: 12000, setupHours: 1.5 },
  "CANON DIGITAL C10000": { rate: 6000, setupHours: 0.5 },
  "CANON DIGITAL C800": { rate: 4000, setupHours: 0.5 },
};

function addHours(dt: Date, hours: number): Date {
  return new Date(dt.getTime() + hours * 3_600_000);
}

function addDays(dt: Date, days: number): Date {
  return new Date(dt.getTime() + days * 86_400_000);
}

function setUtcTime(dt: Date, hour: number, minute: number, second: number, ms: number): Date {
  const d = new Date(dt);
  d.setUTCHours(hour, minute, second, ms);
  return d;
}

// Direct port of apply_calendar_bounds (app.py:1261-1269).
//   - hour < 8   -> snap to 8am, SAME day
//   - hour >= 17 -> snap to 8am, NEXT day
//   - then UNCONDITIONALLY loop-skip Sat/Sun (this runs regardless of
//     which branch above fired, or neither — an in-hours Saturday
//     still gets pushed to Monday)
export function applyCalendarBounds(dt: Date): Date {
  let result = new Date(dt);
  if (result.getUTCHours() < SHIFT_START_HOUR) {
    result = setUtcTime(result, SHIFT_START_HOUR, 0, 0, 0);
  } else if (result.getUTCHours() >= SHIFT_END_HOUR) {
    result = setUtcTime(addDays(result, 1), SHIFT_START_HOUR, 0, 0, 0);
  }
  while (result.getUTCDay() === 0 || result.getUTCDay() === 6) {
    result = setUtcTime(addDays(result, 1), SHIFT_START_HOUR, 0, 0, 0);
  }
  return result;
}

// Direct port of _next_working_day_start (app.py:1271-1284). Used ONLY
// for Printing -> Die Cutter, which is UNCHANGED by this session's
// scheduling-rule decision.
export function nextWorkingDayStart(upstreamStartDt: Date): Date {
  const nextDay = setUtcTime(addDays(upstreamStartDt, 1), SHIFT_START_HOUR, 0, 0, 0);
  return applyCalendarBounds(nextDay);
}

// DELIBERATE DEVIATION FROM SOURCE — the one place this port
// intentionally does not match app.py. The source's Die Cutter ->
// Folder Gluer transition (app.py:1400-1404) calls
// _next_working_day_start(die_cutter_start_time) — the same
// next-calendar-day rule as every other transition. Per the resolved
// product decision in MIGRATION_STATUS.md ("Resolved design decision —
// Die Cutter to Folder Gluer scheduling"), confirmed directly by the
// business owner: this transition instead starts 3 hours after Die
// Cutter's ACTUAL start time, SAME day (not next-day), for every job
// that goes through this transition regardless of type. Still passed
// through applyCalendarBounds afterward, same as every other computed
// start time, so it still snaps forward if the 3-hour mark lands
// outside 8am-5pm or on a weekend.
export function dieCutterToFolderGluerStart(dieCutterActualStart: Date): Date {
  return applyCalendarBounds(addHours(dieCutterActualStart, 3));
}

export interface ExistingJobFinish {
  machine: string;
  // Nullable: get_db_jobs()'s own window deliberately includes rows
  // with a null finish_time (defensively, per its docstring) — the
  // source drops these via pd.to_datetime(..., errors='coerce') +
  // dropna() before taking the max, so this must too, rather than
  // crash trying to parse null as a timestamp.
  finish_time: string | null;
}

// Direct port of get_machine_next_available_time (app.py:1286-1303).
// existingJobs is a snapshot the caller already fetched (matching
// get_db_jobs()'s own 72-hour-plus-all-future-dated window, already
// established elsewhere in this codebase) — this function does no I/O
// itself, so the same snapshot must be reused across every call within
// one add_multi_part_job run, exactly like the source: get_db_jobs() is
// re-queried on every call in Python too, but since add_multi_part_job
// doesn't INSERT any of this job's own records until after every stage
// has been computed, no stage ever sees an earlier stage of the SAME
// job as backlog — only jobs that were already in the database before
// this call started.
export function getMachineNextAvailableTime(
  machineName: string,
  requestedStartDt: Date,
  existingJobs: ExistingJobFinish[]
): Date {
  const machineJobs = existingJobs.filter((j) => j.machine === machineName);
  if (machineJobs.length === 0) {
    return applyCalendarBounds(requestedStartDt);
  }
  const finishTimes = machineJobs
    .filter((j): j is ExistingJobFinish & { finish_time: string } => j.finish_time !== null)
    .map((j) => parseTimestamptz(j.finish_time))
    .filter((d) => !Number.isNaN(d.getTime()));
  if (finishTimes.length === 0) {
    return applyCalendarBounds(requestedStartDt);
  }
  const maxFinish = new Date(Math.max(...finishTimes.map((d) => d.getTime())));
  return maxFinish.getTime() > requestedStartDt.getTime()
    ? applyCalendarBounds(maxFinish)
    : applyCalendarBounds(requestedStartDt);
}

// Direct port of calculate_production_time (app.py:1305-1328): setup
// hours deducted once up front, then a day-by-day walk consuming
// `rate` impressions per available hour, rolling over to the next
// working day whenever today's remaining shift hours run out.
export function calculateProductionTime(
  startDt: Date,
  impressions: number,
  machineName: string,
  applySetup = true
): Date {
  const mach = MACHINE_DATA[machineName] ?? { rate: 1000, setupHours: 1.0 };
  const rate = mach.rate;
  const setup = applySetup ? mach.setupHours : 0;

  let currentTime = applyCalendarBounds(startDt);
  if (applySetup) {
    currentTime = applyCalendarBounds(addHours(currentTime, setup));
  }

  let remainingImps = impressions;
  while (remainingImps > 0) {
    currentTime = applyCalendarBounds(currentTime);
    const workdayEnd = setUtcTime(currentTime, SHIFT_END_HOUR, 0, 0, 0);
    const availableHours = (workdayEnd.getTime() - currentTime.getTime()) / 3_600_000;

    if (availableHours <= 0) {
      currentTime = setUtcTime(addDays(currentTime, 1), SHIFT_START_HOUR, 0, 0, 0);
      continue;
    }

    const possibleToday = availableHours * rate;
    if (remainingImps <= possibleToday) {
      currentTime = addHours(currentTime, remainingImps / rate);
      remainingImps = 0;
    } else {
      remainingImps -= possibleToday;
      currentTime = setUtcTime(addDays(currentTime, 1), SHIFT_START_HOUR, 0, 0, 0);
    }
  }
  return applyCalendarBounds(currentTime);
}

export interface ComponentInput {
  // A list, matching add_multi_part_job's actual parameter shape — the
  // Phase 1 form only ever produces a single-element array per
  // component (its UI has one press-machine dropdown per component,
  // not a multi-select), but the scheduling function itself supports
  // more than one machine per component, so that's preserved here
  // rather than narrowed to a single `machine: string`.
  machines: string[];
  impressions: number;
}

export interface MultiPartJobInput {
  name: string;
  jobOrderNo: string;
  salesRep: string;
  totalQty: number;
  typeId: number; // "ups"
  totalVal: number;
  components: ComponentInput[];
  finishingMachines: string[];
  // Caller-supplied: job_data['start_date'] combined with the
  // operator's current wall-clock time, UTC-labeled — matches
  // datetime.combine(start_date, datetime.now().time()).replace(tzinfo=timezone.utc)
  // exactly. Computed by the caller (never inside this pure module) so
  // this function stays deterministic for tests.
  anchorStart: Date;
}

export interface JobRecord {
  job_name: string;
  tracking_id: string;
  machine: string;
  sales_rep: string;
  quantity: number;
  ups: number;
  impressions: number;
  start_time: string;
  finish_time: string;
  contract_value: number;
  job_order_no: string;
  sequence_no: number;
  planned_start: string;
  planned_finish: string;
  stage_status: "Scheduled";
}

// Direct port of add_multi_part_job (app.py:1330-1430), minus the
// tracking_id random-suffix generation (trackingId is a caller-supplied
// parameter here, for the same determinism reason as anchorStart) and
// minus the final `for r in records: supabase.table('jobs').insert(r)`
// loop — this function only BUILDS the record list; the caller decides
// whether/how to persist it.
export function buildMultiPartJobRecords(
  jobData: MultiPartJobInput,
  existingJobs: ExistingJobFinish[],
  trackingId: string
): JobRecord[] {
  const totalStages =
    jobData.components.reduce((sum, c) => sum + c.machines.length, 0) + jobData.finishingMachines.length;
  const valPerStage = totalStages > 0 ? jobData.totalVal / totalStages : 0;

  const printingStarts: Date[] = [];
  const printingFinishes: Date[] = [];
  const records: JobRecord[] = [];
  let seq = 0;

  for (const comp of jobData.components) {
    for (const machine of comp.machines) {
      const allocatedStart = getMachineNextAvailableTime(machine, jobData.anchorStart, existingJobs);
      const finish = calculateProductionTime(allocatedStart, comp.impressions, machine);
      printingStarts.push(allocatedStart);
      printingFinishes.push(finish);
      seq += 1;
      records.push({
        job_name: jobData.name,
        tracking_id: trackingId,
        machine,
        sales_rep: jobData.salesRep,
        quantity: Math.trunc(jobData.totalQty),
        ups: Math.trunc(jobData.typeId),
        impressions: Math.trunc(comp.impressions),
        start_time: allocatedStart.toISOString(),
        finish_time: finish.toISOString(),
        contract_value: valPerStage,
        job_order_no: jobData.jobOrderNo,
        sequence_no: seq,
        planned_start: allocatedStart.toISOString(),
        planned_finish: finish.toISOString(),
        stage_status: "Scheduled",
      });
    }
  }

  const earliestBase =
    printingFinishes.length > 0
      ? new Date(Math.max(...printingFinishes.map((d) => d.getTime())))
      : applyCalendarBounds(jobData.anchorStart);

  // Die Cutter can start the calendar day after printing began — not
  // once printing is fully finished. Multiple press components use the
  // LATEST press start among them (the last press to begin is the real
  // bottleneck), not the earliest.
  const pressReadyForCut =
    printingStarts.length > 0
      ? nextWorkingDayStart(new Date(Math.max(...printingStarts.map((d) => d.getTime()))))
      : earliestBase;

  // Sort key mirrors the source's own two-tier substring check exactly:
  // the SORT uses the loose "DIE"/"FOLDER" substrings, while the
  // PROCESSING loop below uses the more specific "DIE CUTTER"/"FOLDER
  // GLUER" substrings. Only one machine in MACHINE_DATA matches either
  // loose substring today, so this asymmetry is moot in practice — kept
  // exactly as-is rather than silently unified, since this is a
  // faithful port, not a cleanup pass.
  const rank = (machineName: string) => {
    const upper = machineName.toUpperCase();
    if (upper.includes("DIE")) return 0;
    if (upper.includes("FOLDER")) return 1;
    return 2;
  };
  const orderedFinishing = [...jobData.finishingMachines].sort((a, b) => rank(a) - rank(b));

  let lastStageFinish = earliestBase;
  let dieCutterStartTime: Date | null = null;
  let calculationQty = jobData.totalQty;

  for (const machineName of orderedFinishing) {
    const upper = machineName.toUpperCase();
    let fStart: Date;
    let fFinish: Date;

    if (upper.includes("DIE CUTTER")) {
      calculationQty = jobData.totalQty / Math.max(1, jobData.typeId);
      fStart = getMachineNextAvailableTime(machineName, pressReadyForCut, existingJobs);
      fFinish = calculateProductionTime(fStart, calculationQty, machineName);
      dieCutterStartTime = fStart;
      lastStageFinish = fFinish;
    } else if (upper.includes("FOLDER GLUER") && dieCutterStartTime !== null) {
      // Folding/gluing can start 3 hours after die-cutting began — see
      // dieCutterToFolderGluerStart's own doc comment for why this is a
      // deliberate deviation from the source's literal
      // _next_working_day_start(die_cutter_start_time) call here.
      calculationQty = jobData.totalQty;
      const staggerOffset = dieCutterToFolderGluerStart(dieCutterStartTime);
      fStart = getMachineNextAvailableTime(machineName, staggerOffset, existingJobs);
      fFinish = calculateProductionTime(fStart, calculationQty, machineName);
      lastStageFinish = fFinish;
    } else {
      // Also where Folder Gluer lands if it was selected WITHOUT Die
      // Cutter also being selected (dieCutterStartTime stays null) —
      // matches the source's own elif condition exactly: Folder Gluer
      // only gets the special stagger rule when Die Cutter ran first in
      // this same job.
      calculationQty = jobData.totalQty;
      fStart = getMachineNextAvailableTime(machineName, lastStageFinish, existingJobs);
      fFinish = calculateProductionTime(fStart, calculationQty, machineName);
      lastStageFinish = fFinish;
    }

    seq += 1;
    records.push({
      job_name: jobData.name,
      tracking_id: trackingId,
      machine: machineName,
      sales_rep: jobData.salesRep,
      quantity: Math.trunc(jobData.totalQty),
      ups: Math.trunc(jobData.typeId),
      impressions: Math.trunc(calculationQty),
      start_time: fStart.toISOString(),
      finish_time: fFinish.toISOString(),
      contract_value: valPerStage,
      job_order_no: jobData.jobOrderNo,
      sequence_no: seq,
      planned_start: fStart.toISOString(),
      planned_finish: fFinish.toISOString(),
      stage_status: "Scheduled",
    });
  }

  return records;
}
