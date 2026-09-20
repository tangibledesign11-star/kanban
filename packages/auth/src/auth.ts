import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { env } from "next-runtime-env";

import type { dbClient } from "@kan/db/client";
import * as schema from "@kan/db/schema";
import { sendEmail } from "@kan/email";

import { createDatabaseHooks, createMiddlewareHooks } from "./hooks";
import { createPlugins } from "./plugins";
import { configuredProviders } from "./providers";

export const initAuth = (db: dbClient) => {
  const isDev = process.env.NODE_ENV !== "production";
  const defaultBaseURL = isDev
    ? `http://localhost:${process.env.PORT || "3000"}`
    : undefined;
  const baseURL =
    env("NEXT_PUBLIC_BASE_URL") || env("BETTER_AUTH_URL") || defaultBaseURL;
  const trustedOrigins =
    env("BETTER_AUTH_TRUSTED_ORIGINS")?.split(",").filter(Boolean) ?? [];

  const devOrigins = isDev ? ["http://localhost:*", "http://127.0.0.1:*"] : [];

  return betterAuth({
    secret: env("BETTER_AUTH_SECRET"),
    baseURL,
    trustedOrigins: [
      ...(baseURL ? [baseURL] : []),
      ...devOrigins,
      ...trustedOrigins,
    ],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        ...schema,
        user: schema.users,
      },
    }),
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24 * 2, // Update session expiry every 48 hours if user is active
      freshAge: 0,
    },
    emailAndPassword: {
      enabled: env("NEXT_PUBLIC_ALLOW_CREDENTIALS")?.toLowerCase() === "true",
      // Sign-up restriction is handled by the user.create.before database
      // hook which checks for pending invitations, allowing invited users
      // to register even when public sign-up is disabled.
      disableSignUp: false,
      sendResetPassword: async (data) => {
        await sendEmail(data.user.email, "Reset Password", "RESET_PASSWORD", {
          resetPasswordUrl: data.url,
          resetPasswordToken: data.token,
        });
      },
    },
    socialProviders: configuredProviders,
    user: {
      deleteUser: {
        enabled: true,
      },
      additionalFields: {
        stripeCustomerId: {
          type: "string",
          required: false,
          defaultValue: null,
          input: false,
        },
      },
    },
    plugins: createPlugins(db),
    databaseHooks: createDatabaseHooks(db),
    hooks: createMiddlewareHooks(db),
    advanced: {
      cookiePrefix: "kan",
      database: {
        generateId: false,
      },
    },
  });
};
