import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import EmailProvider from "next-auth/providers/email";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "../db/client";

// @auth/prisma-adapter's own `@prisma/client` type has no generated models
// in this project (Prisma 7's `prisma-client` generator writes to a custom
// output path instead, see server/db/client.ts). Deriving the expected
// param type from PrismaAdapter itself avoids importing that empty type
// directly; the runtime shape is identical. Revisit if @auth/prisma-adapter
// adds custom-output support.
type AdapterPrismaClient = Parameters<typeof PrismaAdapter>[0];

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma as unknown as AdapterPrismaClient),
  session: { strategy: "database" },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
    EmailProvider({
      server: process.env.EMAIL_SERVER,
      from: process.env.EMAIL_FROM,
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
};
