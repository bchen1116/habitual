import type { Metadata, Viewport } from "next";
import { Anton, Archivo, Barlow_Condensed, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { NetworkBanner } from "@/components/network-banner";
import "./globals.css";

// viewport-fit=cover makes env(safe-area-inset-*) real when the app is
// installed to a home screen (display: standalone): without it those insets
// are 0 and the bottom nav can't pin itself above the iPhone home
// indicator. Next keeps its width/initial-scale defaults alongside this.
export const viewport: Viewport = {
  viewportFit: "cover",
};

const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-anton",
});

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
});

const barlowCondensed = Barlow_Condensed({
  weight: ["500", "600", "700", "800"],
  subsets: ["latin"],
  variable: "--font-barlow",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ),
  title: "Habitual",
  description:
    "Put your money where your habits are. Track habits solo or with friends — with real stakes.",
  openGraph: {
    title: "Habitual",
    description:
      "Put your money where your habits are. Track habits solo or with friends — with real stakes.",
    images: ["/og-image.png"],
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Habitual",
    statusBarStyle: "default",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${anton.variable} ${archivo.variable} ${barlowCondensed.variable} ${geistMono.variable} font-sans antialiased`}
      >
        {/* attribute="class" matches globals.css's Tailwind v4 dark variant
            (`@custom-variant dark (&:where(.dark, .dark *))`), which expects
            a literal .dark class on an ancestor — same mechanism the old
            hand-rolled pre-paint script used, this just adds a persisted
            manual override (localStorage) on top of the system default,
            still applied before first paint via next-themes' own blocking
            script (no flash-of-wrong-theme, no hydration mismatch). */}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <NetworkBanner />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
