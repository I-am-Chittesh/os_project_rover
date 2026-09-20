import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "honeybadger | Field Intelligence",
  description: "Local vision telemetry dashboard for honeybadger.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
