import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";
import { PREFS_BOOT_SCRIPT } from "@/lib/admin/prefs";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-mono-jet",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://wms.geniusitens.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Genius WMS — Warehouse Management for Import Storage",
    template: "%s · Genius WMS",
  },
  description:
    "Gate-in to gate-out in one system. Inward receiving, location-level put-away, dispatch approval, packing and GST-ready billing for import material warehousing.",
  applicationName: "Genius WMS",
  keywords: [
    "warehouse management system",
    "WMS India",
    "import storage",
    "GRN",
    "put-away",
    "dispatch management",
    "bonded warehouse",
  ],
  authors: [{ name: "Genius ITens" }],
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "Genius WMS",
    title: "Genius WMS — Warehouse Management for Import Storage",
    description:
      "Gate-in to gate-out in one system. Inward, put-away, dispatch, packing and GST-ready billing.",
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "Genius WMS",
    description:
      "Warehouse management for import material storage — inward to dispatch, one system.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#081615",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <head>
        {/*
          The admin panel's theme and text size, applied before the
          browser is able to paint anything.

          This has to be in the HEAD. It used to sit in the admin
          layout, which renders inside `<body>` — roughly 3,500 bytes
          in, while the stylesheet that paints the dark background is
          200 bytes in. Everything between those two points is a window
          in which the browser has the CSS, has a body, and has no
          theme: it paints dark, then repaints light when the script
          finally arrives. On one machine the document lands in a single
          chunk and that window is 0ms; over a real connection it is a
          network segment wide, and it was reported as a black blink —
          worst on the heaviest screen, because that is the one with the
          longest wait.

          A synchronous script here cannot lose that race. A page has
          nothing to paint until the head is finished.

          A bare `<script>`, NOT `next/script`. `beforeInteractive`
          sounds like the right tool and is the opposite of it: it is
          injected as a deferred load rather than a parser-blocking
          tag, so the theme arrives well after first paint. Measured
          under throttling it turned a clean load into six dark frames
          on /admin/audit, where the plain tag gives none. The name
          describes hydration, not painting.

          Static and identical for every request, so this layout still
          renders statically, and it reads the address before it does
          anything — the marketing pages this layout also wraps are left
          exactly as designed. Nothing in the string is user-supplied.
        */}
        <script dangerouslySetInnerHTML={{ __html: PREFS_BOOT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-verdigris-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
        >
          Skip to content
        </a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
