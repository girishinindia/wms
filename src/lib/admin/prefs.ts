/**
 * Display preferences for the admin panel: theme and text size.
 *
 * Both are per browser (localStorage), both are applied to `<html>` —
 * `data-theme` for the palette, `style.fontSize` for the scale — and
 * both must be applied BEFORE first paint or the page flashes dark and
 * small before settling. `PREFS_BOOT_SCRIPT` is that pre-paint step,
 * inlined by the admin layout; the shell then takes over.
 *
 * Only the admin sets these. The marketing site never does, so a full
 * page load into it (every link out of the panel is one) arrives with
 * neither attribute and renders as designed.
 */

export const THEME_KEY = "wms.admin.theme";
export const FONT_KEY = "wms.admin.font";

export type Theme = "dark" | "light";

/** Percent of the browser default. 100 is the design size. */
export const FONT_STEPS = [87.5, 100, 112.5, 125] as const;
export type FontStep = (typeof FONT_STEPS)[number];
export const DEFAULT_FONT: FontStep = 100;

export function readTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function readFont(): FontStep {
  try {
    const n = Number(window.localStorage.getItem(FONT_KEY));
    return (FONT_STEPS as readonly number[]).includes(n) ? (n as FontStep) : DEFAULT_FONT;
  } catch {
    return DEFAULT_FONT;
  }
}

export function applyTheme(theme: Theme): void {
  const el = document.documentElement;
  if (theme === "light") el.setAttribute("data-theme", "light");
  else el.removeAttribute("data-theme");
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode */
  }
}

export function applyFont(step: FontStep): void {
  document.documentElement.style.fontSize = step === 100 ? "" : `${step}%`;
  try {
    window.localStorage.setItem(FONT_KEY, String(step));
  } catch {
    /* private mode */
  }
}

/** Remove both from `<html>` — when the shell unmounts. */
export function clearPrefs(): void {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.fontSize = "";
}

/**
 * Runs before React, from a <script> in the admin layout. Reads the same
 * two keys and applies them the same way. Kept tiny and dependency-free
 * because it is inlined verbatim.
 */
export const PREFS_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});if(t==="light")document.documentElement.setAttribute("data-theme","light");var f=Number(localStorage.getItem(${JSON.stringify(
  FONT_KEY,
)}));if([87.5,112.5,125].indexOf(f)>-1)document.documentElement.style.fontSize=f+"%";}catch(e){}})();`;
