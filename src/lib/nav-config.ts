import {
  LayoutDashboard,
  LayoutTemplate,
  Factory,
  Wrench,
  FilePlus2,
  ClipboardList,
  Warehouse,
  Truck,
  ShieldCheck,
  Archive,
  History,
  TrendingUp,
  FlaskConical,
  type LucideIcon,
} from "lucide-react";

export type Role = string;

export const ADMIN_ROLES: Role[] = ["admin", "manager", "supervisor", "md", "fm"];
export const WAREHOUSE_ROLES: Role[] = ["warehouse"];
export const FINANCE_ROLES: Role[] = ["finance"];
// Narrow, single-purpose role: only gates Production Layout Builder
// (ADMIN_ROLES | SCHEDULER_ROLES there). Doesn't touch Authorization
// Center / Archive's existing ADMIN_ROLES-only gates.
export const SCHEDULER_ROLES: Role[] = ["scheduler"];
// Only gates Raise Job Order / My Order Tracker (ADMIN_ROLES |
// RAISE_ORDER_ROLES there). "front desk" matches rbac.py's actual
// stored role string; "operations" was added after the initial pass
// missed that Victor Matibag's real Operations account needs the same
// access. Case-insensitive via hasRole()'s existing lowercase
// comparison, same as every other *_ROLES constant here.
export const RAISE_ORDER_ROLES: Role[] = ["front desk", "operations"];

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Roles allowed to see this item. Omit for "any authenticated user". */
  roles?: Role[];
  /**
   * Additional, role-INDEPENDENT visibility condition — ORed against
   * `roles` (not ANDed), so a Guest-only sales rep sees the item even
   * though "Guest" alone wouldn't unlock anything role-gated, and a
   * Front-Desk-plus-sales-rep account keeps every one of their normal
   * Front Desk items too. Confirmed live (disposable accounts, both
   * the Guest-only and dual-role cases) — see this task's own report.
   * If omitted, an item with no `roles` stays open to any authenticated
   * user exactly as before; setting this makes the item hidden by
   * default until isSalesRep is true, even with no `roles` set.
   */
  requiresSalesRep?: boolean;
  badgeKey?: "pendingApprovals";
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

// Mirrors app.py's sidebar construction:
//   ops_modules   = ["Command Center", "Shop Floor Control", "Production Board"]
//   (+ "Production Layout Builder" inserted for ADMIN_ROLES|SCHEDULER_ROLES)
//   admin_modules = ["Raise Job Order", "My Order Tracker"] — both
//   gated to ADMIN_ROLES|RAISE_ORDER_ROLES (was unrestricted
//   originally; narrowed deliberately later, see each page.tsx)
//   (+ "Warehouse" for ADMIN_ROLES|WAREHOUSE_ROLES, "Dispatch" for
//    ADMIN_ROLES|FINANCE_ROLES, + admin-only Authorization Center /
//    Approved Orders Archive. Audit Log is open to any authenticated
//    user, matching Production Board/Shop Floor Control's convention —
//    it was admin-only originally, opened up deliberately later.)
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Plant Operations",
    items: [
      { label: "Command Center", href: "/command-center", icon: LayoutDashboard },
      { label: "Production Layout Builder", href: "/production-layout", icon: LayoutTemplate, roles: [...ADMIN_ROLES, ...SCHEDULER_ROLES] },
      { label: "Production Board", href: "/production-board", icon: Factory },
      { label: "Shop Floor Control", href: "/shop-floor", icon: Wrench },
    ],
  },
  {
    label: "Administrative Portal",
    items: [
      { label: "Raise Job Order", href: "/raise-order", icon: FilePlus2, roles: [...ADMIN_ROLES, ...RAISE_ORDER_ROLES] },
      { label: "My Order Tracker", href: "/my-orders", icon: ClipboardList, roles: [...ADMIN_ROLES, ...RAISE_ORDER_ROLES] },
      // Same conceptual pattern as My Order Tracker — a personal,
      // self-filtered view, not a role-gated one. No `roles` here
      // deliberately: visibility is purely requiresSalesRep, matching
      // the confirmed dual-role reality (Bertha/Mohammed/Mante hold
      // Front Desk but are gated here only by is_sales_rep).
      { label: "My Sales Dashboard", href: "/my-sales-dashboard", icon: TrendingUp, requiresSalesRep: true },
      { label: "Warehouse", href: "/warehouse", icon: Warehouse, roles: [...ADMIN_ROLES, ...WAREHOUSE_ROLES] },
      { label: "Dispatch", href: "/dispatch", icon: Truck, roles: [...ADMIN_ROLES, ...FINANCE_ROLES] },
      { label: "Samples", href: "/samples", icon: FlaskConical, roles: [...ADMIN_ROLES, ...FINANCE_ROLES] },
      { label: "Authorization Center", href: "/authorization", icon: ShieldCheck, roles: ADMIN_ROLES, badgeKey: "pendingApprovals" },
      { label: "Approved Orders Archive", href: "/archive", icon: Archive, roles: ADMIN_ROLES },
      { label: "Audit Log", href: "/audit-log", icon: History },
    ],
  },
];

// Shared by canSeeItem (nav visibility) and page-level access guards
// (Warehouse/Dispatch) so both use the exact same role comparison.
export function hasRole(role: Role | null, allowedRoles: Role[]): boolean {
  if (!role) return false;
  const normalizedRole = role.trim().toLowerCase();
  return allowedRoles.some((allowed) => allowed.trim().toLowerCase() === normalizedRole);
}

export function canSeeItem(item: NavItem, role: Role | null, isSalesRep: boolean): boolean {
  // requiresSalesRep is an OR, not an AND: satisfying it alone is
  // enough regardless of role/roles. Checked first so it can grant
  // visibility a role-gated item's own `roles` list would otherwise
  // deny (the Guest-only sales rep case).
  if (item.requiresSalesRep && isSalesRep) return true;
  if (!item.roles) {
    // No role restriction: open to any authenticated user — UNLESS
    // requiresSalesRep is set and wasn't satisfied above, in which
    // case that's the item's only gate and it stays hidden.
    return !item.requiresSalesRep;
  }
  return hasRole(role, item.roles);
}
