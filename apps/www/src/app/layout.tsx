import type { Metadata } from "next";
import { SiteShell } from "@fahhhchat/ui";
import "./styles.css";

export const metadata: Metadata = {
  title: "Fahhhchat",
  description: "Anonymous stranger text chat with safety-first realtime matching."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}
