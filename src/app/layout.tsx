import type { Metadata } from "next";
import { Anton, Archivo, Barlow_Condensed, Geist_Mono } from "next/font/google";
import { NetworkBanner } from "@/components/network-banner";
import "./globals.css";

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

// Applies the .dark class from the system preference before first paint and
// keeps it in sync if the preference changes. Manual override comes later.
const darkModeScript = `
(function () {
  try {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var apply = function () {
      document.documentElement.classList.toggle("dark", mq.matches);
    };
    apply();
    mq.addEventListener("change", apply);
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: darkModeScript }} />
      </head>
      <body
        className={`${anton.variable} ${archivo.variable} ${barlowCondensed.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <NetworkBanner />
        {children}
      </body>
    </html>
  );
}
