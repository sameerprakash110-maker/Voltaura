import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";

import { AppStateProvider } from "@/components/providers/app-state";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
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
    default: "EcoTwin — See Waste. Understand Why. Prove the Savings.",
    template: "%s · EcoTwin",
  },
  description:
    "An AI-powered digital twin that detects abnormal building resource consumption, identifies probable causes, recommends evidence-based interventions, and verifies the savings they actually produce.",
};

export const viewport: Viewport = {
  themeColor: "#060c0b",
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
      className={`${inter.variable} ${display.variable} ${mono.variable}`}
    >
      <head>
        {/*
          Applied before paint so a light-theme user never sees a dark flash.
          Kept inline and tiny for exactly that reason.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=JSON.parse(localStorage.getItem('ecotwin.prefs.v1')||'{}');if(p.theme){document.documentElement.setAttribute('data-theme',p.theme);}}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <AppStateProvider>{children}</AppStateProvider>
      </body>
    </html>
  );
}
