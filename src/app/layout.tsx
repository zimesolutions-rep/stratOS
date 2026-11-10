import type { Metadata } from "next";
import "./globals.css";

const product = process.env.NEXT_PUBLIC_PRODUCT_NAME || "StratOS";

export const metadata: Metadata = {
  title: { default: product, template: `%s · ${product}` },
  description: "Work OS and AI CRM: leads, pipeline, calls, cadences and tickets in one workspace",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
