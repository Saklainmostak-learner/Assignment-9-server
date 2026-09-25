import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";

export function createAuth(database, mongoClient) {
  return betterAuth({
    database: mongodbAdapter(database, {
      client: mongoClient,
    }),

    secret: process.env.BETTER_AUTH_SECRET,

    baseURL:
      process.env.BETTER_AUTH_URL ||
      "http://localhost:5000",

    trustedOrigins: [
      process.env.CLIENT_URL ||
        "http://localhost:5173",
    ],

    emailAndPassword: {
      enabled: true,
    },
  });
}