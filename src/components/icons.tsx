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
