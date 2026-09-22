import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import { AppStateProvider } from "@/components/providers/app-state";

import "./globals.css";

/*
 * Two typefaces, and only two. Inter carries every piece of language in the
 * product; JetBrains Mono carries every measured quantity. Keeping the split
 * strictly semantic -- prose versus telemetry -- is what makes a screen full of
 * figures scan as instrumentation rather than as marketing.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "VOLTAURA — Detect. Understand. Act. Verify.",
    template: "%s · VOLTAURA",
  },
  description:
    "An AI-powered digital twin that detects abnormal building resource consumption, identifies probable causes, recommends evidence-based interventions, and verifies the savings they actually produce.",
};

export const viewport: Viewport = {
  themeColor: "#090b0c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${inter.variable} ${mono.variable}`}
    >
      <head>
        {/*
          Applied before paint so a light-theme user never sees a dark flash.
          Kept inline and tiny for exactly that reason.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=JSON.parse(localStorage.getItem('voltaura.prefs.v1')||'{}');if(p.theme){document.documentElement.setAttribute('data-theme',p.theme);}}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <AppStateProvider>{children}</AppStateProvider>
      </body>
    </html>
  );
}
