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
    .select("full_name, role, department, is_sales_rep")
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
    };
  }

  return {
    email: user.email,
    fullName: profile.full_name ?? user.email,
    role: profile.role ?? "Front Desk",
    department: profile.department ?? "NONE",
    isSalesRep: profile.is_sales_rep ?? false,
  };
}
