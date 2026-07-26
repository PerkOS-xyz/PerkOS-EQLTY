import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

dotenv.config({
  path: [
    fileURLToPath(new URL("../../.env.local", import.meta.url)),
    fileURLToPath(new URL("../../.env", import.meta.url)),
  ],
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
const privateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

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
  ROBINHOOD_MAINNET_RPC_URL: optional(z.string().url()),
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
  UNISWAP_UNIVERSAL_ROUTER_ADDRESS: address.default(
    "0x8876789976decbfcbbbe364623c63652db8c0904",
  ),
  UNISWAP_PERMIT2_ADDRESS: address.default(
    "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  ),
  EQLTY_VAULT_ADDRESS: optional(address),
  EQLTY_VAULT_DEPLOYMENT_BLOCK: optional(
    z.string().max(78).regex(/^(0|[1-9]\d*)$/),
  ),
  EQLTY_TRADER_PRIVATE_KEY: optional(privateKey),
  EQLTY_RISK_SIGNER_PRIVATE_KEY: optional(privateKey),
  EQLTY_EXECUTION_MODE: z
    .enum(["disabled", "live"])
    .default("disabled"),
  EQLTY_EXECUTION_CONFIRM: optional(z.literal("ROBINHOOD_MAINNET")),
  EQLTY_MAX_INPUT_AMOUNT: z
    .string()
    .max(78)
    .regex(/^[1-9]\d*$/)
    .refine((value) => BigInt(value) < 2n ** 256n)
    .default("1000000"),
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
  GRAPH_RISK_URL: optional(z.string().url()),
  EQLTY_GRAPH_ADAPTER_URL: optional(z.string().url()),
  EQLTY_GRAPH_ACCESS_TOKEN: optional(z.string().min(32)),
  GRAPH_API_TOKEN: optional(z.string().min(1)),
  GRAPH_MAX_PROVIDER_AGE_SECONDS: z.coerce
    .number()
    .int()
    .min(5)
    .max(86_400)
    .default(90),
  GRAPH_MAX_SWAP_AGE_SECONDS: z.coerce
    .number()
    .int()
    .min(5)
    .max(86_400)
    .default(3_600),
  GRAPH_MAX_PRICE_DEVIATION_BPS: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(1_000),
  GRAPH_MAX_LAG_BLOCKS: z.coerce
    .number()
    .int()
    .min(0)
    .max(100_000)
    .default(25),
  EQLTY_SESSION_SECRET: optional(z.string().min(32)),
  SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(86_400)
    .default(3_600),
  PERKOS_API_URL: z.string().url().default("https://api.perkos.xyz"),
  PERKOS_FIREBASE_API_KEY: optional(z.string().min(20)),
  PERKOS_FIREBASE_PROJECT_ID: z
    .string()
    .regex(/^[a-z0-9-]{4,64}$/)
    .default("perkos-app"),
  PERKOS_FLEET_MODE: z
    .enum(["disabled", "preview", "live"])
    .default("preview"),
  PERKOS_HERMES_IMAGE_TAG: optional(z.string().min(3).max(256)),
  ONECLAW_API_BASE: z
    .string()
    .url()
    .default("https://api.1claw.xyz"),
  ONECLAW_PLATFORM_APP_ID: optional(z.string().uuid()),
  ONECLAW_PLATFORM_API_KEY: optional(
    z.string().regex(/^plt_[A-Za-z0-9._-]{8,}$/),
  ),
  ONECLAW_PLATFORM_TEMPLATE_ID: optional(z.string().uuid()),
  ONECLAW_PLATFORM_RETURN_URL: optional(z.string().url()),
  EQLTY_ONECLAW_MIN_AMOUNT_USDG: z
    .string()
    .max(78)
    .regex(/^[1-9]\d*$/)
    .refine((value) => BigInt(value) < 2n ** 256n)
    .default("3000000"),
  ENS_ROOT_NAME: optional(z.string().min(3).max(255)),
  EQLTY_ENS_RECORDS_CHAIN_ID: z.coerce
    .number()
    .int()
    .refine((value) => value === 8453 || value === 84532)
    .default(84532),
  EQLTY_ENS_RECORDS_RPC_URL: optional(z.string().url()),
  EQLTY_ENS_L2_REGISTRY_ADDRESS: optional(address),
  EQLTY_ENS_REGISTRAR_PRIVATE_KEY: optional(privateKey),
  ENS_POLICY_VERSION: z.coerce.number().int().positive().default(1),
  ENS_POLICY_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(2_592_000)
    .default(604_800),
  ENS_POLICY_ALLOWED_TICKERS: z.string().default("NVDA,AMZN,ORCL"),
  ENS_POLICY_MAX_AMOUNT_PER_TRADE: z
    .string()
    .max(78)
    .regex(/^(0|[1-9]\d*)$/)
    .default("1000000"),
  ENS_POLICY_PAUSED: booleanValue("false"),
  ENS_POLICY_MAX_DEVIATION_BPS: z.coerce
    .number()
    .int()
    .min(1)
    .max(2_000)
    .default(300),
  ENS_POLICY_MIN_LIQUIDITY_USD: z.coerce
    .number()
    .finite()
    .min(0)
    .max(1_000_000_000_000)
    .default(50_000),
  ENS_POLICY_MAX_ORACLE_AGE_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(86_400)
    .default(300),
  ENS_SCOUT_ADDRESS: optional(address),
  ENS_RISK_ADDRESS: optional(address),
  ENS_TRADER_ADDRESS: optional(address),
  ENS_AUDITOR_ADDRESS: optional(address),
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
