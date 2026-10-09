import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.url(),
  APP_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  OWNER_EMAIL: z.email(),
  OWNER_NAME: z.string().min(1).default("Owner"),
  OWNER_PASSWORD: z.string().min(12).max(128),
});
export type Config = z.infer<typeof schema>;
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid environment: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  if (
    result.data.NODE_ENV === "production" &&
    new URL(result.data.APP_URL).protocol !== "https:"
  )
    throw new Error("Production APP_URL must use HTTPS");
  return result.data;
}
