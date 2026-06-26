"use client";

import { SessionProvider } from "next-auth/react";

/** Wraps client components so `useSession` works for the login UI. */
export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
