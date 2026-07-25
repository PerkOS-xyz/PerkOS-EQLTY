import express from "express";
import { z } from "zod";
import { loadGraphAdapterConfig } from "./graph-adapter-config.js";
import { GraphAdapterSink } from "./graph-adapter-sink.js";

const tickerSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9.-]{0,11}$/)
  .transform((ticker) => ticker.toUpperCase());

const config = loadGraphAdapterConfig();
const sink = new GraphAdapterSink(config);
await sink.start();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "8kb" }));

app.get("/health", (_request, response) => {
  const status = sink.status();
  return response.status(status.running ? 200 : 503).json({
    service: "EQLTY Graph Adapter",
    ...status,
  });
});

app.post("/api/graph-risk", (request, response) => {
  const parsed = tickerSchema.safeParse(request.body?.ticker);
  if (!parsed.success) {
    return response.status(400).json({ error: "invalid_ticker" });
  }
  const evidence = sink.snapshot(parsed.data);
  if (!evidence) {
    return response.status(404).json({
      error: "evidence_not_observed",
      ticker: parsed.data,
    });
  }
  response.setHeader("cache-control", "no-store");
  return response.json(evidence);
});

const server = app.listen(config.EQLTY_GRAPH_PORT, "0.0.0.0", () => {
  console.log(`EQLTY Graph Adapter listening on ${config.EQLTY_GRAPH_PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    sink.stop();
    server.close(() => process.exit(0));
  });
}
