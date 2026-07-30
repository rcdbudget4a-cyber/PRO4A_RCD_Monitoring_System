import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PRO 4A Retirees and KIPO/WIPO Monitoring System",
  description: "PRO 4A monitoring system for compulsory retirees and KIPO/WIPO records.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: [{ url: "/favicon-retirees-kipowipo.png", type: "image/png", sizes: "1254x1254" }],
    shortcut: "/favicon-retirees-kipowipo.png",
    apple: [{ url: "/favicon-retirees-kipowipo.png", type: "image/png", sizes: "1254x1254" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
