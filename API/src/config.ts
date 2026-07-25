import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({
  path: new URL("../../.env", import.meta.url),
  quiet: true,
});

const booleanValue = (fallback: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(fallback)
    .transform((value) => value === "true");

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(4021),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  PUBLIC_PROJECT_NAME: z.string().min(1).max(80).default("EQLTY"),
  PUBLIC_SERVICE_SLUG: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default("eqlty-api"),
  DEMO_MODE: booleanValue("true"),
  REQUIRE_LIVE_DATA: booleanValue("false"),
  ROBINHOOD_CHAIN_ID: z.coerce.number().int().positive().default(4663),
  UNISWAP_CHAIN_ID: z.coerce.number().int().positive().default(4663),
});

export type ApiConfig = z.infer<typeof schema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  const result = schema.safeParse(environment);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid API configuration: ${problems}`);
  }
  return result.data;
}
