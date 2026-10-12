/** Words for delivery-note codes — safe to use in the browser and on the server. */

export const PACKING = ["CARTON", "BUNDLE", "LOOSE", "PACKAGE", "OTHER"] as const;
export const HANDLING = ["NORMAL", "FRAGILE", "HANDLE_WITH_CARE"] as const;

export const PACKING_LABEL: Record<string, string> = {
  CARTON: "Cartons",
  BUNDLE: "Bundles",
  LOOSE: "Loose",
  PACKAGE: "Package",
  OTHER: "Other",
};

export const HANDLING_LABEL: Record<string, string> = {
  NORMAL: "Normal",
  FRAGILE: "Fragile",
  HANDLE_WITH_CARE: "Handle with care",
};
