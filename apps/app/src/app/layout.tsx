import type { Metadata } from "next";
import { SiteShell } from "@fahhhchat/ui";
import { ConsentBanner } from "../components/ConsentBanner";
import "./styles.css";

export const metadata: Metadata = {
  title: "Fahhhchat App",
  description: "Anonymous realtime stranger chat."
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
        <ConsentBanner />
      </body>
    </html>
  );
}
