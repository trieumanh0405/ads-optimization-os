import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ads Optimization OS",
  description: "Decision support system for media buying teams."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
