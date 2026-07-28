import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface AuthUser {
  email: string;
  fullName: string;
  role: string;
  department: string;
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
    .select("full_name, role, department")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    console.error("requireUser: failed to fetch profile for", user.email, error);
    return {
      email: user.email,
      fullName: user.email,
      role: "Front Desk",
      department: "NONE",
    };
  }

  return {
    email: user.email,
    fullName: profile.full_name ?? user.email,
    role: profile.role ?? "Front Desk",
    department: profile.department ?? "NONE",
  };
}
