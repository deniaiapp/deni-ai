import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { MotionProvider } from "@/components/motion";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Deni Run",
  description: "AI teammates with an isolated computer for every account.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-mode="dark"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden bg-[#050505] text-[#f0f0f0] tracking-tight">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
