// Standalone, hand-verifiable test harness for
// src/app/production-layout/scheduling.ts — the ported scheduling
// engine (apply_calendar_bounds, calculate_production_time,
// get_machine_next_available_time, add_multi_part_job). No UI, no
// database, no test framework: run with `npx tsx scripts/verify-scheduling.ts`
// and read the printed trace against the numbers below by hand.
//
// This exists specifically so the deliberate deviation from source (the
// Die Cutter -> Folder Gluer transition using a 3-hour-same-day rule
// instead of the source's next-calendar-day rule) can be confirmed
// correct BEFORE this engine is wired to a real form or writes to the
// jobs table.
import {
  applyCalendarBounds,
  calculateProductionTime,
  getMachineNextAvailableTime,
  nextWorkingDayStart,
  dieCutterToFolderGluerStart,
  buildMultiPartJobRecords,
  MACHINE_DATA,
} from "../src/app/production-layout/scheduling";

function fmt(d: Date): string {
  // toUTCString includes the weekday name, so weekend-skip / hour-bound
  // behavior can be read directly off the printed line without having
  // to independently look up what day of the week a date falls on.
  return d.toUTCString();
}

function utc(y: number, m: number, d: number, h: number, min = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, h, min, 0, 0));
}

function section(title: string) {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);
}

// ─────────────────────────────────────────────────────────────────────
// TEST 0 — applyCalendarBounds directly, the foundation every other
// function in this module builds on.
// ─────────────────────────────────────────────────────────────────────
section("TEST 0 — applyCalendarBounds: before-hours, after-hours, weekend");
{
  const beforeHours = utc(2026, 8, 3, 6, 30); // Monday 06:30 -> too early
  console.log(`Input:  ${fmt(beforeHours)}`);
  console.log(`Expected: snapped to SAME day 08:00 (hour < 8).`);
  console.log(`ACTUAL:   ${fmt(applyCalendarBounds(beforeHours))}\n`);

  const afterHours = utc(2026, 8, 3, 18, 15); // Monday 18:15 -> too late
  console.log(`Input:  ${fmt(afterHours)}`);
  console.log(`Expected: snapped to NEXT day (Tuesday) 08:00 (hour >= 17).`);
  console.log(`ACTUAL:   ${fmt(applyCalendarBounds(afterHours))}\n`);

  const onSaturday = utc(2026, 8, 8, 10, 0); // Saturday 10:00 -> in-hours but weekend
  console.log(`Input:  ${fmt(onSaturday)}`);
  console.log(`Expected: in-hours but a weekend day -> pushed to Monday 08:00, NOT just left alone.`);
  console.log(`ACTUAL:   ${fmt(applyCalendarBounds(onSaturday))}`);
}

// ─────────────────────────────────────────────────────────────────────
// TEST 1 — calculateProductionTime, single-day, no setup
// SM102-CX FOUR COLOUR: rate 8,000/hr. 40,000 impressions.
// Hand math: 40,000 / 8,000 = 5 hours. Start Mon 08:00 -> finish 13:00
// same day (well within the 08:00-17:00 shift, no setup applied).
// ─────────────────────────────────────────────────────────────────────
section("TEST 1 — calculateProductionTime, single-day, no setup applied");
{
  const machine = "SM102-CX FOUR COLOUR";
  const start = utc(2026, 8, 3, 8, 0); // pick any date; printed weekday below
  const impressions = 40_000;
  console.log(`Machine: ${machine} (rate=${MACHINE_DATA[machine].rate}/hr, setup=${MACHINE_DATA[machine].setupHours}h)`);
  console.log(`Start:   ${fmt(start)}`);
  console.log(`Impressions: ${impressions.toLocaleString()}`);
  console.log(`Hand math: ${impressions} / ${MACHINE_DATA[machine].rate} = ${impressions / MACHINE_DATA[machine].rate} hours needed.`);
  console.log(`Expected finish: same day, start + ${impressions / MACHINE_DATA[machine].rate}h = 13:00 UTC.`);
  const finish = calculateProductionTime(start, impressions, machine, /* applySetup */ false);
  console.log(`ACTUAL finish:   ${fmt(finish)}`);
}

// ─────────────────────────────────────────────────────────────────────
// TEST 2 — calculateProductionTime, with setup hours applied
// Same machine/impressions as Test 1, but applySetup=true (the default
// add_multi_part_job always uses). Setup 1.5h pushes the start to
// 09:30, so the 5 production hours land at 14:30.
// ─────────────────────────────────────────────────────────────────────
section("TEST 2 — same as Test 1, but with the machine's setup hours applied");
{
  const machine = "SM102-CX FOUR COLOUR";
  const start = utc(2026, 8, 3, 8, 0);
  const impressions = 40_000;
  console.log(`Setup hours: ${MACHINE_DATA[machine].setupHours}h -> production actually starts ${MACHINE_DATA[machine].setupHours}h after ${fmt(start)}, i.e. 09:30 UTC.`);
  console.log(`Then 5 production hours -> expected finish 14:30 UTC, same day.`);
  const finish = calculateProductionTime(start, impressions, machine, true);
  console.log(`ACTUAL finish: ${fmt(finish)}`);
}

// ─────────────────────────────────────────────────────────────────────
// TEST 3 — calculateProductionTime, multi-day rollover + exact 5pm edge
// GTO 52 MANUAL-2 COLOUR: rate 4,000/hr, setup 2.0h. 100,000 impressions,
// starting Monday 08:00.
//   Day 1 (Mon): setup -> 10:00. Available 17:00-10:00 = 7h.
//                possible = 7*4000 = 28,000 < 100,000 remaining.
//                remaining -> 72,000. Roll to Tue 08:00.
//   Day 2 (Tue): available 9h. possible = 9*4000 = 36,000 < 72,000.
//                remaining -> 36,000. Roll to Wed 08:00.
//   Day 3 (Wed): available 9h. possible = 36,000 >= remaining(36,000)
//                EXACTLY -> finish = Wed 08:00 + 9h = Wed 17:00.
//   Final apply_calendar_bounds: hour 17 >= SHIFT_END_HOUR(17) is TRUE
//   (>=, not >), so this snaps FORWARD to Thursday 08:00 despite the
//   raw math landing exactly on the shift boundary. This is the
//   trickiest hand-check in this harness — the >= in
//   apply_calendar_bounds's elif is what makes an exact-5pm finish
//   invalid, not just a finish that overshoots 5pm.
// ─────────────────────────────────────────────────────────────────────
section("TEST 3 — multi-day rollover landing EXACTLY on the 17:00 boundary");
{
  const machine = "GTO 52 MANUAL-2 COLOUR";
  const start = utc(2026, 8, 3, 8, 0); // a Monday, per Test 1's date
  const impressions = 100_000;
  console.log(`Machine: ${machine} (rate=${MACHINE_DATA[machine].rate}/hr, setup=${MACHINE_DATA[machine].setupHours}h)`);
  console.log(`Start: ${fmt(start)}, impressions: ${impressions.toLocaleString()}`);
  console.log(`Hand math: setup -> 10:00 Mon. Day1 possible 28,000 (remaining 72,000).`);
  console.log(`Day2 possible 36,000 (remaining 36,000). Day3 possible EXACTLY 36,000 -> raw finish Wed 17:00.`);
  console.log(`Expected ACTUAL finish (post-bounds snap): Thursday 08:00 UTC.`);
  const finish = calculateProductionTime(start, impressions, machine, true);
  console.log(`ACTUAL finish: ${fmt(finish)}`);
}

// ─────────────────────────────────────────────────────────────────────
// TEST 4 — applyCalendarBounds skips a weekend after a Friday rollover
// POLAR MACHINE FOR SHEETS: rate 50,000/hr, setup 1.0h. 500,000
// impressions, starting Friday 08:00.
//   Setup -> 09:00. Available 17:00-09:00 = 8h. possible = 400,000 <
//   500,000. remaining -> 100,000. Roll to "Saturday 08:00" — but the
//   top of the next loop iteration calls applyCalendarBounds on that,
//   which pushes Sat -> Sun -> Monday 08:00 (both weekend days skipped
//   in the same bounds call).
//   Day (Mon): available 9h, possible 450,000 >= remaining 100,000 ->
//   finish = Mon 08:00 + (100,000/50,000)h = Mon 10:00.
// ─────────────────────────────────────────────────────────────────────
section("TEST 4 — Friday rollover skips the whole weekend, resumes Monday");
{
  const machine = "POLAR MACHINE FOR SHEETS";
  const start = utc(2026, 8, 7, 8, 0); // the Friday of the same week as Test 1's Monday
  const impressions = 500_000;
  console.log(`Machine: ${machine} (rate=${MACHINE_DATA[machine].rate}/hr, setup=${MACHINE_DATA[machine].setupHours}h)`);
  console.log(`Start: ${fmt(start)}, impressions: ${impressions.toLocaleString()}`);
  console.log(`Hand math: setup -> 09:00 Fri. Day1 possible 400,000 (remaining 100,000), rolls toward Saturday.`);
  console.log(`applyCalendarBounds must skip BOTH Sat and Sun -> resumes Monday 08:00.`);
  console.log(`Expected ACTUAL finish: Monday 10:00 UTC (100,000 / 50,000 = 2h after Monday 08:00).`);
  const finish = calculateProductionTime(start, impressions, machine, true);
  console.log(`ACTUAL finish: ${fmt(finish)}`);
}

// ─────────────────────────────────────────────────────────────────────
// TEST 5 — getMachineNextAvailableTime: a busy machine's own backlog
// wins over the requested start time.
// ─────────────────────────────────────────────────────────────────────
section("TEST 5 — machine backlog overrides the requested start time");
{
  const machine = "DIE CUTTER";
  const requested = utc(2026, 8, 3, 8, 0); // Monday 08:00
  const backlogFinish = "2026-08-05T10:00:00+00:00"; // Wednesday 10:00 — later than requested
  console.log(`Requested start: ${fmt(requested)}`);
  console.log(`Existing backlog on ${machine}: finish_time = ${backlogFinish}`);
  console.log(`Expected: backlog finish (Wed) is later than the request (Mon), so the machine's own`);
  console.log(`queue wins -> ACTUAL should equal applyCalendarBounds(backlog finish) = unchanged`);
  console.log(`(already an in-hours weekday): Wed 10:00 UTC.`);
  const result = getMachineNextAvailableTime(machine, requested, [{ machine, finish_time: backlogFinish }]);
  console.log(`ACTUAL: ${fmt(result)}`);
}

// ─────────────────────────────────────────────────────────────────────
// TEST 6 — THE deliberate deviation: dieCutterToFolderGluerStart
// vs. what the OLD (source) rule would have produced.
// ─────────────────────────────────────────────────────────────────────
section("TEST 6 — Die Cutter -> Folder Gluer: 3-hours-same-day vs. the OLD next-day rule");
{
  const dieCutterStart = utc(2026, 8, 3, 8, 0); // Monday 08:00
  console.log(`Die Cutter actual start: ${fmt(dieCutterStart)}`);
  console.log(`\nOLD source rule (_next_working_day_start) — NOT used here, shown only for contrast:`);
  const oldRule = nextWorkingDayStart(dieCutterStart);
  console.log(`  would have been: ${fmt(oldRule)}  <- next CALENDAR DAY, wrong per the resolved decision`);
  console.log(`\nNEW rule actually implemented (dieCutterToFolderGluerStart):`);
  console.log(`  Expected: 3 hours after Die Cutter's start, SAME day -> Monday 11:00 UTC (well within 08:00-17:00, no snap needed).`);
  const newRule = dieCutterToFolderGluerStart(dieCutterStart);
  console.log(`  ACTUAL: ${fmt(newRule)}`);

  console.log(`\n--- Same check, but Die Cutter starts late enough that +3h crosses 17:00 ---`);
  const lateDieCutterStart = utc(2026, 8, 3, 15, 0); // Monday 15:00
  console.log(`Die Cutter actual start: ${fmt(lateDieCutterStart)}`);
  console.log(`Expected: 15:00 + 3h = 18:00, which is >= SHIFT_END_HOUR(17) -> snaps forward to Tuesday 08:00.`);
  const lateResult = dieCutterToFolderGluerStart(lateDieCutterStart);
  console.log(`ACTUAL: ${fmt(lateResult)}`);

  console.log(`\n--- Same check, but Die Cutter starts on a Friday late enough to cross into the weekend ---`);
  const fridayDieCutterStart = utc(2026, 8, 7, 15, 0); // Friday 15:00
  console.log(`Die Cutter actual start: ${fmt(fridayDieCutterStart)}`);
  console.log(`Expected: 15:00 + 3h = 18:00 Friday -> hour>=17 snaps to Saturday 08:00 -> weekend loop -> Monday 08:00.`);
  const fridayResult = dieCutterToFolderGluerStart(fridayDieCutterStart);
  console.log(`ACTUAL: ${fmt(fridayResult)}`);
}

// ─────────────────────────────────────────────────────────────────────
// TEST 7 — buildMultiPartJobRecords, full end-to-end job with BOTH Die
// Cutter and Folder Gluer selected, no existing backlog on any machine.
// One print component: SM102-CX FOUR COLOUR, 40,000 impressions.
// total_qty = 40,000, ups (type_id) = 1.
// ─────────────────────────────────────────────────────────────────────
section("TEST 7 — full job: SM102-CX -> Die Cutter -> Folder Gluer, no backlog");
{
  const anchorStart = utc(2026, 8, 3, 8, 0); // Monday 08:00
  const records = buildMultiPartJobRecords(
    {
      name: "Verification Job",
      jobOrderNo: "TEST-VERIFY-001",
      salesRep: "Test Harness",
      totalQty: 40_000,
      typeId: 1,
      totalVal: 3000,
      components: [{ machines: ["SM102-CX FOUR COLOUR"], impressions: 40_000 }],
      finishingMachines: ["DIE CUTTER", "FOLDER GLUER"],
      anchorStart,
    },
    [], // no existing backlog anywhere
    "JOB-VERIFY-TEST7"
  );

  console.log(`anchor_start: ${fmt(anchorStart)}\n`);
  console.log(`Hand-trace:`);
  console.log(`  1. SM102-CX (rate 8000, setup 1.5h): setup -> 09:30 Mon. 40,000/8000=5h -> press finish 14:30 Mon.`);
  console.log(`     Press START (used for Die Cutter's next-working-day calc) = applyCalendarBounds(anchor) = Mon 08:00.`);
  console.log(`  2. press_ready_for_cut = nextWorkingDayStart(latest press START = Mon 08:00) = Tue 08:00.`);
  console.log(`  3. Die Cutter (rate 3000, setup 1.5h): qty = 40,000/max(1,ups=1) = 40,000.`);
  console.log(`     start = applyCalendarBounds(Tue 08:00, no backlog) = Tue 08:00.`);
  console.log(`     setup -> 09:30 Tue. 40,000/3000=13.33h -> Day1 available 7.5h (possible 22,500 < 40,000,`);
  console.log(`     remaining 17,500, roll to Wed 08:00). Day2 available 9h, possible 27,000 >= 17,500 ->`);
  console.log(`     finish = Wed 08:00 + (17,500/3000)h = Wed 08:00 + 5.8333h = Wed 13:50.`);
  console.log(`     Die Cutter ACTUAL START (feeds the 3-hour rule) = Tue 08:00 (from step 3, before setup).`);
  console.log(`  4. Folder Gluer stagger = dieCutterToFolderGluerStart(Tue 08:00) = Tue 11:00 (3h later, same day, in-hours).`);
  console.log(`     Folder Gluer (rate 12000, setup 1.5h): qty = full 40,000 (NOT divided by ups this time).`);
  console.log(`     start = applyCalendarBounds(Tue 11:00, no backlog) = Tue 11:00.`);
  console.log(`     setup -> 12:30 Tue. Available 17:00-12:30=4.5h. possible=4.5*12000=54,000 >= 40,000 ->`);
  console.log(`     finish = Tue 12:30 + (40,000/12000)h = Tue 12:30 + 3.3333h = Tue 15:50.`);
  console.log();

  for (const r of records) {
    console.log(
      `  seq ${r.sequence_no}: ${r.machine.padEnd(22)} start=${r.start_time}  finish=${r.finish_time}  impressions=${r.impressions}`
    );
  }
}

console.log("\nDone. Compare every ACTUAL line above against its Expected/Hand math line.");
