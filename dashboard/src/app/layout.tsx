import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SkyBot v2 • Control Dashboard",
  description:
    "Live control dashboard for SkyBot v2 — a Hypixel Skyblock AH flip tracker & TTS Discord bot running on Railway.",
  keywords: [
    "SkyBot",
    "Hypixel",
    "Skyblock",
    "AH flips",
    "Discord bot",
    "Railway",
  ],
  authors: [{ name: "SkyBot v2" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "SkyBot v2 Control Dashboard",
    description: "Live AH flip tracker & TTS monitoring for SkyBot v2",
    type: "website",
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <SonnerToaster position="bottom-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
