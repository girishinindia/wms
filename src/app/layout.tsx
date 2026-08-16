import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

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
      <body className="flex min-h-full flex-col font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-verdigris-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
