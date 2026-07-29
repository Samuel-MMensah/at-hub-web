import { AppShell } from "@/components/shell/app-shell";
import { TopBar } from "@/components/shell/topbar";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { ShopFloorClient, type PipelineRow, type FloorJobRow } from "./shop-floor-client";

// get_shop_floor_timeline() is built on get_db_jobs(), the same
// 72-hour-windowed jobs fetch Command Center's bookRunsQueue/
// packagingSkillets already use — not an unbounded fetch of all jobs.
async function getShopFloorData() {
  const supabase = await createClient();
  const jobsWindowStart = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

  const [pipelineRes, jobsRes] = await Promise.all([
    supabase.from("job_pipeline_status").select("*"),
    supabase
      .from("jobs")
      .select(
        "tracking_id, job_order_no, job_name, machine, sequence_no, stage_status, start_time, finish_time, revised_finish, quantity, contract_value"
      )
      .or(`finish_time.gte.${jobsWindowStart},finish_time.is.null`),
  ]);

  const pipelineRows = (pipelineRes.data ?? []) as Omit<PipelineRow, "customer_name">[];
  const jobRows = (jobsRes.data ?? []) as Omit<FloorJobRow, "customer_name">[];

  const orderNos = Array.from(
    new Set(
      [...pipelineRows.map((r) => r.job_order_no), ...jobRows.map((r) => r.job_order_no)].filter(
        (v): v is string => Boolean(v)
      )
    )
  );

  const ordersMap = new Map<string, string | null>();
  if (orderNos.length > 0) {
    const { data: ordersData } = await supabase
      .from("job_orders")
      .select("job_order_no, customer_name")
      .in("job_order_no", orderNos);
    for (const o of ordersData ?? []) {
      if (o.job_order_no) ordersMap.set(o.job_order_no, o.customer_name);
    }
  }

  const pipeline: PipelineRow[] = pipelineRows.map((r) => ({
    ...r,
    customer_name: ordersMap.get(r.job_order_no) ?? null,
  }));

  const jobs: FloorJobRow[] = jobRows.map((r) => ({
    ...r,
    customer_name: r.job_order_no ? (ordersMap.get(r.job_order_no) ?? null) : null,
  }));

  return { pipeline, jobs };
}

export default async function ShopFloorPage() {
  // No role gate — matches app.py: any authenticated user.
  const user = await requireUser();
  const { pipeline, jobs } = await getShopFloorData();

  return (
    <AppShell userName={user.fullName} userRole={user.role} role={user.role}>
      <TopBar
        title="Appointed Time Printing Ltd."
        subtitle="Secured Capacity Planning Engine"
      />

      <div className="mb-4 text-lg font-bold text-at-navy-soft">Live Production Timeline</div>

      <ShopFloorClient pipeline={pipeline} jobs={jobs} />
    </AppShell>
  );
}
