import type { Metadata } from "next";
import "./product.css";

export const metadata: Metadata = {
  title: "Ads Optimization OS · Internal",
  description: "Hệ thống chuẩn hóa KPI, rule engine và action queue cho media buyers."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
