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
      { label: "Warehouse", href: "/warehouse", icon: Warehouse, roles: [...ADMIN_ROLES, ...WAREHOUSE_ROLES] },
      { label: "Dispatch", href: "/dispatch", icon: Truck, roles: [...ADMIN_ROLES, ...FINANCE_ROLES] },
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

export function canSeeItem(item: NavItem, role: Role | null): boolean {
  if (!item.roles) return true;
  return hasRole(role, item.roles);
}
