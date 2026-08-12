import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { IdleTimeoutProvider } from "@/components/shell/idle-timeout-provider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Appointed Time | Enterprise Suite",
  description: "Appointed Time Printing Ltd. — Secured Capacity Planning Engine",
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
        <IdleTimeoutProvider>{children}</IdleTimeoutProvider>
      </body>
    </html>
  );
}
