import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./shell.css";
import "./market.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "EQLTY",
  description: "Agent powered stock token decisions with verifiable evidence.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
