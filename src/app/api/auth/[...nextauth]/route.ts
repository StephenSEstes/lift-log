import NextAuth, { type NextAuthOptions, type Session } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import type { JWT } from "next-auth/jwt";

type ExtendedToken = JWT & { accessToken?: string };
type ExtendedSession = Session & { accessToken?: string };

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/spreadsheets",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        (token as ExtendedToken).accessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }) {
      const nextSession = session as ExtendedSession;
      nextSession.accessToken = (token as ExtendedToken).accessToken;
      return nextSession;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
