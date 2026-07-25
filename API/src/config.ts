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
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional(),
  );
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

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
  UNISWAP_API_KEY: optional(z.string().min(1)),
  UNISWAP_API_URL: z
    .string()
    .url()
    .default("https://trade-api.gateway.uniswap.org/v1"),
  INPUT_TOKEN_ADDRESS: address.default(
    "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  ),
  SWAPPER_ADDRESS: optional(address),
  MAINNET_QUOTE_AMOUNT: z
    .string()
    .max(78)
    .regex(/^[1-9]\d*$/)
    .default("1000000"),
  REFERENCE_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(172_800)
    .default(86_400),
  EQLTY_SESSION_SECRET: optional(z.string().min(32)),
  SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(86_400)
    .default(3_600),
  PERKOS_API_URL: z.string().url().default("https://api.perkos.xyz"),
  PERKOS_FIREBASE_API_KEY: optional(z.string().min(20)),
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
