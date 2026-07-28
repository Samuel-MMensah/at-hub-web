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
//   (+ "Production Layout Builder" inserted for admins)
//   admin_modules = ["Raise Job Order", "My Order Tracker"]
//   (+ "Warehouse" for ADMIN_ROLES|WAREHOUSE_ROLES, "Dispatch" for
//    ADMIN_ROLES|FINANCE_ROLES, + admin-only Authorization Center /
//    Approved Orders Archive / Audit Log)
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Plant Operations",
    items: [
      { label: "Command Center", href: "/command-center", icon: LayoutDashboard },
      { label: "Production Layout Builder", href: "/production-layout", icon: LayoutTemplate, roles: ADMIN_ROLES },
      { label: "Production Board", href: "/production-board", icon: Factory },
      { label: "Shop Floor Control", href: "/shop-floor", icon: Wrench },
    ],
  },
  {
    label: "Administrative Portal",
    items: [
      { label: "Raise Job Order", href: "/raise-order", icon: FilePlus2 },
      { label: "My Order Tracker", href: "/my-orders", icon: ClipboardList },
      { label: "Warehouse", href: "/warehouse", icon: Warehouse, roles: [...ADMIN_ROLES, ...WAREHOUSE_ROLES] },
      { label: "Dispatch", href: "/dispatch", icon: Truck, roles: [...ADMIN_ROLES, ...FINANCE_ROLES] },
      { label: "Authorization Center", href: "/authorization", icon: ShieldCheck, roles: ADMIN_ROLES, badgeKey: "pendingApprovals" },
      { label: "Approved Orders Archive", href: "/archive", icon: Archive, roles: ADMIN_ROLES },
      { label: "Audit Log", href: "/audit-log", icon: History, roles: ADMIN_ROLES },
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
