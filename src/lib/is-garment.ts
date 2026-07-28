// Ports _is_garment() from app.py line 791.
const GARMENT_PRINT_TYPES = new Set([
  "DTF",
  "UV-DTF",
  "SAV",
  "EMBROIDERY",
  "FLEXI SCREEN PRINT",
]);

export interface GarmentClassifiable {
  department: string | null;
  type_of_print: string | null;
  print_type: string | null;
}

export function isGarment(row: GarmentClassifiable): boolean {
  if ((row.department ?? "").trim().toUpperCase() === "GARMENT") return true;
  const printType = (row.type_of_print || row.print_type || "").trim().toUpperCase();
  return GARMENT_PRINT_TYPES.has(printType);
}
