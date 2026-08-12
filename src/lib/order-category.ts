// Single source of truth for the 6-way order category label.
//
// Every consumer (Command Center's category breakdown, and anything later)
// MUST import this — do NOT reimplement the mapping. Classification of
// Garment vs Press is delegated to isGarment() (the only such logic), then the
// department-specific column is mapped to a display label.
//
// Matching is case-INSENSITIVE (values are upper-cased before comparison),
// because the live database stores Press values upper-cased ("OFFSET",
// "DIGITAL PRESS") while the mapping and the UI dropdowns use title case
// ("Offset", "Screen Print", "Flexi") — confirmed against live data, not assumed.
//
// "Commercial Press" is a DISPLAY LABEL ONLY for stored value "Offset"/"OFFSET".
// This function never writes anything back; the stored value stays as-is.
import { isGarment, type GarmentClassifiable } from "@/lib/is-garment";

export const GARMENT_CATEGORIES = ["Screen Print", "Large Format", "Embroidery"] as const;
export const PRESS_CATEGORIES = ["Commercial Press", "Digital Press", "Packaging"] as const;
export const ORDER_CATEGORIES = [...GARMENT_CATEGORIES, ...PRESS_CATEGORIES] as const;

export type OrderCategory = (typeof ORDER_CATEGORIES)[number];
export type OrderCategoryGroup = "Garment" | "Press";

export function categoryGroup(category: OrderCategory): OrderCategoryGroup {
  return (GARMENT_CATEGORIES as readonly string[]).includes(category) ? "Garment" : "Press";
}

/**
 * Returns one of the 6 category labels for a job_orders row, or null if the
 * row's stored value isn't covered by the mapping. Callers must handle null
 * explicitly (surface it, don't silently drop it) — see the console.warn below.
 */
export function orderCategory(row: GarmentClassifiable): OrderCategory | null {
  if (isGarment(row)) {
    // Garment reads print_type (its department column); fall back to
    // type_of_print only if print_type is somehow empty (garment rows mirror
    // the value into both columns at raise time).
    const pt = (row.print_type || row.type_of_print || "").trim().toUpperCase();
    if (pt === "SCREEN PRINT" || pt === "FLEXI SCREEN PRINT") return "Screen Print";
    if (pt === "FLEXI" || pt === "UV-DTF" || pt === "DTF" || pt === "SAV") return "Large Format";
    if (pt === "EMBROIDERY") return "Embroidery";
  } else {
    const tp = (row.type_of_print || "").trim().toUpperCase();
    if (tp === "OFFSET") return "Commercial Press"; // display label only; stored value stays "Offset"
    if (tp === "DIGITAL PRESS") return "Digital Press";
    if (tp === "PACKAGING") return "Packaging";
  }
  // Unmapped — flag it, never silently drop from totals.
  if (typeof console !== "undefined") {
    console.warn(
      `[orderCategory] Unmapped order classification — surfaced, not dropped: ` +
        `department=${row.department ?? "null"}, print_type=${row.print_type ?? "null"}, ` +
        `type_of_print=${row.type_of_print ?? "null"}`
    );
  }
  return null;
}
