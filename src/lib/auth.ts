import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface AuthUser {
  email: string;
  fullName: string;
  role: string;
  department: string;
  // Orthogonal to role — a sales rep can hold any role (Guest, Front
  // Desk, md, ...), confirmed live during the clients-subsystem sales
  // rep task. Gates /my-sales-dashboard.
  isSalesRep: boolean;
  // Orthogonal to BOTH role and isSalesRep — Isaac Kum and Charles Adoo
  // hold both flags at once (2026-09-01). Read the same direct way as
  // isSalesRep (profiles' self-scoped SELECT policy already allows a
  // caller to read their own row) — current_user_is_sales_manager() is
  // for RLS policies to call internally, not something the app itself
  // needs to invoke. Also gates /my-sales-dashboard, additively.
  isSalesManager: boolean;
}

export async function requireUser(): Promise<AuthUser> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    redirect("/login");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("full_name, role, department, is_sales_rep, is_sales_manager")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    console.error("requireUser: failed to fetch profile for", user.email, error);
    return {
      email: user.email,
      fullName: user.email,
      role: "Front Desk",
      department: "NONE",
      isSalesRep: false,
      isSalesManager: false,
    };
  }

  return {
    email: user.email,
    fullName: profile.full_name ?? user.email,
    role: profile.role ?? "Front Desk",
    department: profile.department ?? "NONE",
    isSalesRep: profile.is_sales_rep ?? false,
    isSalesManager: profile.is_sales_manager ?? false,
  };
}
