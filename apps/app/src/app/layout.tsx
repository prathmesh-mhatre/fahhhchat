import type { Metadata } from "next";
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
      <body>{children}</body>
    </html>
  );
}
