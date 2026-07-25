import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./shell.css";

export const metadata: Metadata = {
  title: "EQLTY",
  description: "Agent powered stock token decisions with verifiable evidence.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
