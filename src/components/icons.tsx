import type { SVGProps } from "react";

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  viewBox: "0 0 24 24",
} as const;

type P = SVGProps<SVGSVGElement>;

export const TruckIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M2 7.5A1.5 1.5 0 0 1 3.5 6h9A1.5 1.5 0 0 1 14 7.5V16H2Z" />
    <path d="M14 10h3.6a2 2 0 0 1 1.7.95L21.5 14.5V16H14Z" />
    <circle cx="6" cy="18" r="2" />
    <circle cx="17.5" cy="18" r="2" />
    <path d="M8 18h7.5M2 16h1.9M21.5 16H20" />
  </svg>
);

export const LayersIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3 3 7.5l9 4.5 9-4.5Z" />
    <path d="m3 12 9 4.5L21 12" />
    <path d="m3 16.5 9 4.5 9-4.5" />
  </svg>
);

export const CheckShieldIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3 5 5.6v5.3c0 4.2 2.9 8.1 7 9.1 4.1-1 7-4.9 7-9.1V5.6Z" />
    <path d="m9.2 11.8 2 2 3.6-3.9" />
  </svg>
);

export const BoxIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M20.5 7.8v8.4a1.5 1.5 0 0 1-.8 1.3l-7 3.7a1.5 1.5 0 0 1-1.4 0l-7-3.7a1.5 1.5 0 0 1-.8-1.3V7.8" />
    <path d="m3.7 7.1 7.6-3.9a1.5 1.5 0 0 1 1.4 0l7.6 3.9-8.3 4.3Z" />
    <path d="M12 11.4V21" />
  </svg>
);

export const ReceiptIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 3h14v18l-2.3-1.4-2.4 1.4-2.3-1.4L9.7 21l-2.4-1.4L5 21Z" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </svg>
);

export const BellIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M18 9a6 6 0 1 0-12 0c0 4.2-1.5 5.5-1.5 5.5h15S18 13.2 18 9Z" />
    <path d="M10.3 18a2 2 0 0 0 3.4 0" />
  </svg>
);

export const LockIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
    <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
    <path d="M12 14.5v2" />
  </svg>
);

export const ScanIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M20 8.5V6a2 2 0 0 0-2-2h-2.5M4 15.5V18a2 2 0 0 0 2 2h2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5" />
    <path d="M4 12h16" />
  </svg>
);

export const ChartIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6.5 19V11M12 19V5.5M17.5 19v-5.5" />
  </svg>
);

export const PinIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
);

export const CheckIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const ArrowIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

/* ── Master data ─────────────────────────────────────────────────
   Four more, for the Master section. The existing set is all cargo
   and security; none of it reads as "reference table" at 16px. */

/** Stacked discs. The section itself. */
export const DatabaseIcon = (p: P) => (
  <svg {...base} {...p}>
    <ellipse cx="12" cy="6" rx="7.5" ry="3" />
    <path d="M4.5 6v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V6" />
    <path d="M4.5 12v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-6" />
  </svg>
);

export const GlobeIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
  </svg>
);

/** A folded map — a state as a subdivision, not as a place. */
export const MapIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M9 4 3 6.5v13L9 17l6 3 6-2.5v-13L15 7 9 4Z" />
    <path d="M9 4v13M15 7v13" />
  </svg>
);

/* ── Row actions ─────────────────────────────────────────────────
   Icon buttons need a name a screen reader can read, so every use of
   these carries an aria-label and a title — the icon replaces the
   visible text, not the accessible one. */

export const PencilIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 20h4l10-10a2.83 2.83 0 0 0-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  </svg>
);

/** Power. Deactivate and reactivate are the same control, so they are
 *  the same glyph with a different tint — not two different pictures. */
export const PowerIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 4v8" />
    <path d="M7.1 7.1a7 7 0 1 0 9.8 0" />
  </svg>
);

export const XIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

/** Four cells — a set of categories, which is what a type table is. */
export const GridIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </svg>
);

/** View — an eye. Read-only look at a row, nothing changes. */
export const EyeIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.75" />
  </svg>
);

/** Delete — a bin. Only ever offered for a row nothing points at. */
export const TrashIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 7h16" />
    <path d="M9.5 7V4.5h5V7" />
    <path d="M6.5 7l1 12.5h9l1-12.5" />
    <path d="M10 11v5.5M14 11v5.5" />
  </svg>
);

/** A chevron for sort indicators and disclosure. */
export const ChevronIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

/** Three lines — the menu, on small screens. */
export const MenuIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

/** A panel with a divider — hide or show the sidebar. */
export const SidebarIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <path d="M9 4.5v15" />
  </svg>
);

export const SunIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5" />
  </svg>
);

export const MoonIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </svg>
);
