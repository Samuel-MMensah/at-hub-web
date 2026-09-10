import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { IdleTimeoutProvider } from "@/components/shell/idle-timeout-provider";
import { ServiceWorkerRegistration } from "@/components/shell/service-worker-registration";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Appointed Time | Enterprise Suite",
  description: "Appointed Time Printing Ltd. — Secured Capacity Planning Engine",
  icons: {
    icon: [{ url: "/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // iOS ignores the manifest's display: "standalone" on many versions --
  // this is what actually makes "Add to Home Screen" launch without
  // Safari's address bar/chrome there.
  appleWebApp: {
    capable: true,
    title: "Job Order Hub",
    statusBarStyle: "black-translucent",
  },
  other: {
    // This Next.js version's `appleWebApp.capable` only renders the
    // unprefixed `mobile-web-app-capable` tag (verified against
    // node_modules/next/dist/lib/metadata/metadata.js) — Safari's own
    // standalone-mode detection still keys off the apple-prefixed one,
    // so it has to be added explicitly or "Add to Home Screen" opens
    // inside Safari chrome instead of standalone.
    "apple-mobile-web-app-capable": "yes",
  },
};

// --at-navy from globals.css, matching manifest.ts's theme_color.
export const viewport: Viewport = {
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-at-bg text-at-navy font-sans">
        {/* Mounted once here so the idle timer applies to every authenticated
            page without per-route duplication; it no-ops on /login and
            /reset-password (see IdleTimeoutProvider). */}
        <ServiceWorkerRegistration />
        <IdleTimeoutProvider>{children}</IdleTimeoutProvider>
      </body>
    </html>
  );
}
