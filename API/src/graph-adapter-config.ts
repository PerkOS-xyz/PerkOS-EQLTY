import { z } from "zod";

const schema = z.object({
  EQLTY_GRAPH_PORT: z.coerce.number().int().positive().default(4022),
  EQLTY_GRAPH_API_TOKEN: z.string().min(20),
  EQLTY_GRAPH_RPC_URL: z.string().url(),
  EQLTY_GRAPH_PROVIDER: z
    .string()
    .min(1)
    .default("robinhood.substreams.pinax.network:443"),
  EQLTY_GRAPH_PACKAGE_PATH: z.string().min(1),
  EQLTY_GRAPH_POOL_REGISTRY_PATH: z.string().min(1),
  EQLTY_GRAPH_LOOKBACK_BLOCKS: z.coerce
    .number()
    .int()
    .min(100)
    .max(100_000)
    .default(5_000),
  EQLTY_GRAPH_MAX_PROVIDER_AGE_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(90),
  EQLTY_GRAPH_MAX_SWAP_AGE_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(86_400),
});

export type GraphAdapterConfig = z.infer<typeof schema>;

export function loadGraphAdapterConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GraphAdapterConfig {
  return schema.parse(environment);
}
