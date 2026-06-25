import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { encodeMockGoogleToken } from "@fahhhchat/config";

/**
 * Auth.js/NextAuth configuration for Google login (PRD decision). The real
 * Google provider is wired only when OAuth credentials are present; for local
 * dev (`AUTH_DEV_MODE=true`) or when credentials are absent, a dev-mock
 * "Credentials" provider simulates a Google account so the flow stays demoable.
 *
 * NextAuth only authenticates the user here; the backend is the identity
 * authority. We carry the Google ID token through the session so the browser can
 * exchange it for an internal user + backend app session (see lib/auth-api).
 */
const devModeEnabled =
  process.env.AUTH_DEV_MODE === "true" ||
  !(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const providers: NextAuthConfig["providers"] = [];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET
    })
  );
}

if (devModeEnabled) {
  providers.push(
    Credentials({
      id: "dev-mock",
      name: "Test Google account",
      credentials: {},
      // No real verification: stands in for Google only in dev. The mock token is
      // accepted by the API solely when AUTH_DEV_MODE=true on the backend.
      authorize: async () => {
        const identity = { sub: "dev-google-user", email: "dev@fahhhchat.local" };
        return {
          id: identity.sub,
          email: identity.email,
          idToken: encodeMockGoogleToken(identity)
        };
      }
    })
  );
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers,
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account, user }) {
      // Real Google login surfaces the id_token on `account`; the dev-mock
      // provider passes its mock token through the returned `user`.
      if (account?.id_token) {
        token.idToken = account.id_token;
      }
      const mock = user as { idToken?: string } | undefined;
      if (mock?.idToken) {
        token.idToken = mock.idToken;
      }
      return token;
    },
    async session({ session, token }) {
      // The client only needs the id token to establish the backend session.
      // Strip the Google profile (name/email/image) so the app never holds
      // Google identity client-side — internal identity comes from the backend.
      if (session.user) {
        session.user = {} as typeof session.user;
      }
      (session as { idToken?: unknown }).idToken = token.idToken;
      return session;
    }
  }
});
