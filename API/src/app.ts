import cors from "cors";
import express from "express";
import type { Express } from "express";
import { AutonomousGoalService } from "./autonomous-goals.js";
import type { ApiConfig } from "./config.js";
import { EnsControlPlaneService } from "./ens-control-plane.js";
import { FleetActivationService } from "./fleet-activation.js";
import { GraphEvidenceService } from "./graph-evidence.js";
import { OwnerAuth } from "./owner-auth.js";
import { OpportunityAnalysisService } from "./opportunity-analysis.js";
import { publicConfig } from "./public-config.js";
import { StockCatalogService } from "./stock-catalog.js";
import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const ownerVerification = z.object({
  address,
  nonce: z.string().min(1).max(256),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});
const fleetRole = z.enum(["scout", "risk", "trader", "auditor"]);
const ticker = z.string().regex(/^[A-Za-z][A-Za-z0-9.-]{0,11}$/);
const uint256 = z
  .string()
  .max(78)
  .regex(/^[1-9]\d*$/)
  .refine((value) => BigInt(value) < 2n ** 256n);
const goalInput = z
  .object({
    goal: z.string().trim().min(10).max(500),
    amountIn: uint256,
    windowMinutes: z.number().int().min(2).max(20),
    cadenceSeconds: z.number().int().min(15).max(120).default(30),
    maxCandidates: z.number().int().min(1).max(10).default(3),
    candidateTickers: z
      .array(z.string().regex(/^[A-Za-z][A-Za-z0-9.-]{0,11}$/))
      .min(1)
      .max(10)
      .optional(),
  })
  .strict();
const goalId = z.string().regex(/^[A-Za-z0-9-]{1,128}$/);

type AppDependencies = {
  stockCatalog?: Pick<StockCatalogService, "assessTicker" | "catalog">;
  ownerAuth?: Pick<
    OwnerAuth,
    "challenge" | "logout" | "session" | "verify"
  > &
    Partial<Pick<OwnerAuth, "perkosIdToken">>;
  ensControlPlane?: Pick<EnsControlPlaneService, "resolve">;
  fleetActivation?: Pick<FleetActivationService, "activate">;
  graphEvidence?: Pick<GraphEvidenceService, "evidence">;
  goals?: Pick<AutonomousGoalService, "read" | "start" | "tick">;
};

export function createApp(
  config: ApiConfig,
  dependencies: AppDependencies = {},
): Express {
  const app = express();
  const stockCatalog =
    dependencies.stockCatalog ?? new StockCatalogService(config);
  const ownerAuth = dependencies.ownerAuth ?? new OwnerAuth(config);
  const ensControlPlane =
    dependencies.ensControlPlane ?? new EnsControlPlaneService(config);
  const fleetActivation =
    dependencies.fleetActivation ??
    new FleetActivationService(config, { controlPlane: ensControlPlane });
  const graphEvidence =
    dependencies.graphEvidence ?? new GraphEvidenceService(config);
  const goals =
    dependencies.goals ??
    new AutonomousGoalService(
      new OpportunityAnalysisService(config, {
        catalog: stockCatalog,
        controlPlane: ensControlPlane,
      }),
    );

  app.disable("x-powered-by");
  app.use(
    cors({
      origin: config.APP_ORIGIN,
      credentials: true,
      methods: ["GET", "POST", "OPTIONS"],
    }),
  );
  app.use(express.json({ limit: "128kb" }));

  app.get("/health", (_request, response) => {
    response.setHeader("cache-control", "no-store");
    response.json({
      ok: true,
      service: config.PUBLIC_SERVICE_SLUG,
      mode: config.DEMO_MODE ? "preview" : "live",
    });
  });

  app.get("/api/config", (_request, response) => {
    response.setHeader("cache-control", "public, max-age=30");
    response.json(publicConfig(config));
  });

  app.get("/api/auth/perkos/nonce", async (request, response) => {
    const parsed = address.safeParse(request.query.address);
    if (!parsed.success) {
      return response.status(400).json({ error: "invalid_wallet_address" });
    }
    try {
      response.setHeader("cache-control", "no-store");
      return response.json(
        await ownerAuth.challenge(parsed.data as `0x${string}`),
      );
    } catch (error) {
      return response.status(503).json({
        error: "wallet_login_unavailable",
        message: safeMessage(error),
      });
    }
  });

  app.post("/api/auth/perkos/verify", async (request, response) => {
    const parsed = ownerVerification.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({
        error: "invalid_wallet_signature",
        issues: parsed.error.issues,
      });
    }
    try {
      return response.json(
        await ownerAuth.verify(response, {
          address: parsed.data.address as `0x${string}`,
          nonce: parsed.data.nonce,
          signature: parsed.data.signature as `0x${string}`,
        }),
      );
    } catch (error) {
      return response.status(401).json({
        error: "wallet_login_failed",
        message: safeMessage(error),
      });
    }
  });

  app.get("/api/auth/session", (request, response) => {
    response.setHeader("cache-control", "no-store");
    const session = ownerAuth.session(request);
    return session
      ? response.json(session)
      : response.status(401).json({ error: "owner_session_required" });
  });

  app.post("/api/auth/logout", (_request, response) => {
    ownerAuth.logout(response);
    return response.json({ ok: true });
  });

  app.get("/api/orchestration", async (request, response) => {
    const session = ownerAuth.session(request);
    if (!session) {
      return response
        .status(401)
        .json({ error: "owner_session_required" });
    }
    response.setHeader("cache-control", "no-store");
    return response.json(
      await ensControlPlane.resolve({
        userId: session.fleetUserId,
        owner: session.walletAddress,
      }),
    );
  });

  app.post("/api/fleet/activate", async (request, response) => {
    const session = ownerAuth.session(request);
    if (!session) {
      return response
        .status(401)
        .json({ error: "owner_session_required" });
    }
    try {
      response.setHeader("cache-control", "no-store");
      return response.json(
        await fleetActivation.activate({
          userId: session.fleetUserId,
          owner: session.walletAddress,
          perkosIdToken: ownerAuth.perkosIdToken?.(request),
        }),
      );
    } catch (error) {
      return response.status(503).json({
        error: "fleet_activation_failed",
        message: safeMessage(error),
      });
    }
  });

  app.get("/api/fleet/metadata/:role", async (request, response) => {
    const session = ownerAuth.session(request);
    if (!session) {
      return response
        .status(401)
        .json({ error: "owner_session_required" });
    }
    const parsedRole = fleetRole.safeParse(request.params.role);
    if (!parsedRole.success) {
      return response.status(404).json({ error: "agent_role_not_found" });
    }

    const controlPlane = await ensControlPlane.resolve({
      userId: session.fleetUserId,
      owner: session.walletAddress,
    });
    const settings = controlPlane.agentSettings?.[parsedRole.data];
    if (controlPlane.status !== "active" || !settings) {
      return response.status(503).json({
        error: "agent_metadata_unavailable",
        detail: controlPlane.error,
      });
    }

    response.setHeader("cache-control", "no-store");
    return response.json({
      schema: "urn:eqlty:ens-agent-metadata:v1",
      source:
        config.EQLTY_ENS_RECORDS_CHAIN_ID === 84532
          ? "durin-base-sepolia"
          : "durin-base",
      registry: config.EQLTY_ENS_L2_REGISTRY_ADDRESS,
      chainId: config.EQLTY_ENS_RECORDS_CHAIN_ID,
      rootName: controlPlane.rootName,
      manifestHash: controlPlane.manifestHash,
      role: parsedRole.data,
      name: settings.ensName,
      owner: session.walletAddress,
      settings,
    });
  });

  app.get("/api/evidence/:ticker", async (request, response) => {
    if (!ownerAuth.session(request)) {
      return response
        .status(401)
        .json({ error: "owner_session_required" });
    }
    const parsed = ticker.safeParse(request.params.ticker);
    if (!parsed.success) {
      return response.status(400).json({ error: "invalid_ticker" });
    }
    try {
      response.setHeader("cache-control", "no-store");
      return response.json(await graphEvidence.evidence(parsed.data));
    } catch (error) {
      return response.status(503).json({
        error: "graph_evidence_unavailable",
        message: safeMessage(error),
      });
    }
  });

  app.post("/api/goals", async (request, response) => {
    const session = ownerAuth.session(request);
    if (!session) {
      return response
        .status(401)
        .json({ error: "owner_session_required" });
    }
    const parsed = goalInput.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({
        error: "invalid_goal",
        issues: parsed.error.issues,
      });
    }
    try {
      const activation = await fleetActivation.activate({
        userId: session.fleetUserId,
        owner: session.walletAddress,
        perkosIdToken: ownerAuth.perkosIdToken?.(request),
      });
      if (activation.status === "provisioning") {
        throw new Error("The Hermes fleet is still provisioning");
      }
      const linkedRoles =
        activation.runtime?.agents
          .filter((agent) => agent.oneclaw === "linked")
          .map((agent) => agent.role) ?? [];
      response.setHeader("cache-control", "no-store");
      return response.status(201).json(
        await goals.start({
          ...parsed.data,
          userId: session.fleetUserId,
          owner: session.walletAddress,
          linkedRoles,
        }),
      );
    } catch (error) {
      return response.status(503).json({
        error: "goal_start_failed",
        message: safeMessage(error),
      });
    }
  });

  app.get("/api/goals/:id", async (request, response) => {
    return goalResponse(request, response, "read");
  });

  app.post("/api/goals/:id/tick", async (request, response) => {
    return goalResponse(request, response, "tick");
  });

  async function goalResponse(
    request: express.Request,
    response: express.Response,
    action: "read" | "tick",
  ) {
    const session = ownerAuth.session(request);
    if (!session) {
      return response
        .status(401)
        .json({ error: "owner_session_required" });
    }
    const parsed = goalId.safeParse(request.params.id);
    if (!parsed.success) {
      return response.status(400).json({ error: "invalid_goal_id" });
    }
    const goal = await goals[action](parsed.data, {
      userId: session.fleetUserId,
      owner: session.walletAddress,
    });
    if (!goal) {
      return response.status(404).json({ error: "goal_not_found" });
    }
    response.setHeader("cache-control", "no-store");
    return response.json(goal);
  }

  app.get("/api/assets", async (request, response, next) => {
    const catalog = String(request.query.catalog ?? "");
    const ticker = String(request.query.ticker ?? "").trim();
    if (catalog && catalog !== "uniswap-v4-universe") {
      return response.status(400).json({ error: "unknown_catalog" });
    }

    try {
      response.setHeader("cache-control", "no-store");
      if (ticker) {
        const asset = await stockCatalog.assessTicker(ticker);
        return asset
          ? response.json(asset)
          : response.status(404).json({ error: "asset_not_found" });
      }
      return response.json(
        await stockCatalog.catalog(request.query.refresh === "true"),
      );
    } catch (error) {
      return next(error);
    }
  });

  app.use((_request, response) => {
    response.status(404).json({ error: "not_found" });
  });

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error(error);
      response.status(500).json({ error: "internal_error" });
    },
  );

  return app;
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Authentication failed";
}
