/**
 * The web origins the API trusts for browser CORS and Socket.IO handshakes.
 * Driven by the same env vars as the marketing/app deployments so the HTTP
 * (`main.ts`) and realtime (`realtime.gateway.ts`) surfaces never drift apart.
 */
export function webOrigins(): string[] {
  return [
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001",
    process.env.NEXT_PUBLIC_WWW_URL ?? "http://localhost:3000",
  ];
}
