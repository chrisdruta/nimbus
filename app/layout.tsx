import type { Metadata } from "next";
import { Comfortaa } from "next/font/google";
import "./globals.css";

const comfortaa = Comfortaa({
  subsets: ["latin"],
  weight: "600",
  variable: "--font-comfortaa",
});

export const metadata: Metadata = {
  title: "nimbus",
  description: "A SoundCloud listening client with shuffle that actually works",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={comfortaa.variable}>
      <body>{children}</body>
    </html>
  );
}
