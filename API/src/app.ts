import cors from "cors";
import express from "express";
import type { Express } from "express";
import { AutonomousGoalService } from "./autonomous-goals.js";
import { loadConfig, type ApiConfig } from "./config.js";
import { EnsControlPlaneService } from "./ens-control-plane.js";
import { EnsPolicyPreparationService } from "./ens-policy-preparation.js";
import { EqltyVaultExecutor } from "./eqlty-vault-executor.js";
import { executionTraderAddress } from "./execution-addresses.js";
import type { ExecutionStrategy } from "./execution-types.js";
import { DecisionFeeService } from "./decision-fee.js";
import type { DecisionFeePaymentPayload } from "./decision-fee-types.js";
import { FleetActivationService } from "./fleet-activation.js";
import { FirestoreGoalStore } from "./firestore-goal.js";
import { GraphEvidenceService } from "./graph-evidence.js";
import { OwnerAuth } from "./owner-auth.js";
import { OpportunityAnalysisService } from "./opportunity-analysis.js";
import {
  OneClawFleetProvisioner,
  type OneClawFleetSecurity,
} from "./oneclaw-fleet.js";
import { oneClawGate } from "./oneclaw-policy.js";
import { PortfolioService } from "./portfolio.js";
import { ProofRunService } from "./proof-run.js";
import { publicConfig } from "./public-config.js";
import { PurchaseAuditService } from "./purchase-audit.js";
import { PurchaseHistoryService } from "./purchase-history.js";
import {
  SaleAuditService,
  type CaptureSaleInput,
} from "./sale-audit.js";
import { StockCatalogService } from "./stock-catalog.js";
import { StrategyService } from "./strategy-service.js";
import { StrategyStore } from "./strategy-store.js";
import { UniswapRwaMarketService } from "./uniswap-rwa-market.js";
import { WalletReadinessService } from "./wallet-readiness.js";
import { WalletSwapService } from "./wallet-swap.js";
import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const ownerVerification = z.object({
  address,
  nonce: z.string().min(1).max(256),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});
const fleetRole = z.enum(["scout", "risk", "trader", "auditor"]);
const ticker = z.string().regex(/^[A-Za-z][A-Za-z0-9.-]{0,11}$/);
const normalizedTicker = ticker.transform((value) =>
  value.toUpperCase(),
);
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
const x402Uint = z
  .string()
  .max(78)
  .regex(/^(0|[1-9]\d*)$/)
  .refine((value) => BigInt(value) < 2n ** 256n);
const decisionFeeRequirements = z
  .object({
    scheme: z.literal("exact"),
    network: z.literal("eip155:4663"),
    amount: uint256,
    asset: address,
    payTo: address,
    maxTimeoutSeconds: z.number().int().min(1).max(3_600),
    extra: z
      .object({
        name: z.literal("Global Dollar"),
        version: z.literal("1"),
      })
      .strict(),
  })
  .strict();
const decisionFeePayment = z
  .object({
    x402Version: z.literal(2),
    resource: z
      .object({
        url: z.string().url().max(2_048),
        description: z.string().min(1).max(256),
        mimeType: z.literal("application/json"),
      })
      .strict(),
    accepted: decisionFeeRequirements,
    payload: z
      .object({
        signature: z
          .string()
          .regex(
            /^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/,
          ),
        authorization: z
          .object({
            from: address,
            to: address,
            value: uint256,
            validAfter: x402Uint,
            validBefore: uint256,
            nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
          })
          .strict(),
      })
      .strict(),
    extensions: z.record(z.string(), z.unknown()),
  })
  .strict();
const strategyInput = z
  .object({
    owner: address,
    agent: address,
    ticker: z.string().regex(/^[A-Za-z][A-Za-z0-9.-]{0,11}$/),
    inputToken: address,
    outputToken: address,
    router: address,
    maxAmountPerTrade: uint256,
    maxTotalSpend: uint256,
    maxSlippageBps: z.number().int().min(1).max(1_000),
    expiresAt: z.string().datetime(),
    humanVerified: z.boolean(),
  })
  .strict();
const transactionHash = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((value) => value as `0x${string}`);
const onchainStrategyInput = z
  .object({
    chainId: z.literal(4663),
    strategyId: uint256,
    creationTransactionHash: transactionHash,
    approvalTransactionHash: transactionHash,
    fundingTransactionHash: transactionHash,
  })
  .strict();
const executionStrategyInput = z
  .object({
    id: goalId,
    ticker: ticker,
    owner: address,
    agent: address,
    inputToken: address,
    outputToken: address,
    router: address,
    maxAmountPerTrade: uint256,
    maxTotalSpend: uint256,
    spent: z
      .string()
      .max(78)
      .regex(/^(0|[1-9]\d*)$/)
      .refine((value) => BigInt(value) < 2n ** 256n),
    maxSlippageBps: z.number().int().min(1).max(1_000),
    expiresAt: z.string().datetime(),
    status: z.enum(["active", "paused", "revoked", "expired"]),
    humanProof: z
      .object({
        provider: z.literal("owner-wallet-session"),
        status: z.literal("verified"),
        proofHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
      })
      .strict(),
    executionMode: z.enum(["analysis", "full"]),
    onchain: onchainStrategyInput.optional(),
  })
  .strip();
const runInput = z
  .object({
    strategyId: goalId,
    strategy: executionStrategyInput.optional(),
    amountIn: uint256,
    execute: z.boolean().default(false),
  })
  .strict();
const ensPolicyChange = z
  .object({
    paused: z.boolean(),
    allowedTickers: z.array(normalizedTicker).min(1).max(96),
    maxAmountPerTrade: uint256,
    maxDeviationBps: z.number().int().min(1).max(2_000),
    minLiquidityUsd: z
      .number()
      .finite()
      .min(0)
      .max(1_000_000_000_000),
    maxOracleAgeSeconds: z.number().int().min(1).max(86_400),
  })
  .strict();
const oneclawPlatformInput = z
  .object({
    email: z.string().trim().email().max(320),
  })
  .strict();
const uniswapTransaction = z
  .object({
    to: address,
    from: address,
    data: z.string().regex(/^0x[0-9a-fA-F]+$/).max(65_536),
    value: z.string().max(78).regex(/^(0|0x0*|[1-9]\d*)$/),
    chainId: z.literal(4663),
  })
  .strict();
const walletSellQuote = z
  .object({
    chainId: z.literal(4663),
    direction: z.literal("sell"),
    ticker: normalizedTicker,
    tokenIn: address,
    tokenOut: address,
    amountIn: uint256,
    amountOut: uint256,
    requestId: z.string().min(1).max(256),
    routing: z.string().min(1).max(64),
    quotedAt: z.string().datetime(),
    approval: uniswapTransaction.optional(),
    permitData: z.record(z.string(), z.unknown()).optional(),
    rawQuote: z.record(z.string(), z.unknown()),
  })
  .strict();
const walletSellInput = z
  .object({
    ticker: normalizedTicker,
    tokenIn: address,
    amountIn: uint256,
    maxSlippageBps: z.number().int().min(1).max(1_000).default(100),
  })
  .strict();
const walletSellBuildInput = z
  .object({
    sell: walletSellQuote,
    signature: z
      .string()
      .regex(/^0x[0-9a-fA-F]+$/)
      .max(2_048)
      .optional(),
  })
  .strict();
const saleAuditInput = z
  .object({
    ticker: normalizedTicker,
    tokenIn: address,
    tokenInDecimals: z.number().int().min(0).max(36),
    amountIn: uint256,
    quotedAmountOut: uint256,
    requestId: z.string().min(1).max(256),
    routing: z.string().min(1).max(64),
    transactionHash,
    approvalTransactionHash: transactionHash.optional(),
  })
  .strict();

type AppDependencies = {
  stockCatalog?: Pick<StockCatalogService, "assessTicker" | "catalog">;
  ownerAuth?: Pick<
    OwnerAuth,
    "challenge" | "logout" | "session" | "verify"
  > &
    Partial<Pick<OwnerAuth, "perkosIdToken">>;
  ensControlPlane?: Pick<EnsControlPlaneService, "resolve">;
  ensPolicyPreparation?: Pick<EnsPolicyPreparationService, "prepare"> &
    Partial<Pick<EnsPolicyPreparationService, "publish">>;
  fleetActivation?: Pick<FleetActivationService, "activate">;
  oneclawFleet?: Pick<OneClawFleetProvisioner, "provision" | "ready"> &
    Partial<Pick<OneClawFleetProvisioner, "status">>;
  graphEvidence?: Pick<GraphEvidenceService, "evidence"> &
    Partial<Pick<GraphEvidenceService, "series" | "status">>;
  uniswapRwaMarket?: Pick<UniswapRwaMarketService, "series">;
  goals?: Pick<AutonomousGoalService, "read" | "start" | "tick"> &
    Partial<Pick<AutonomousGoalService, "settleFee">>;
  strategies?: Pick<StrategyService, "create"> &
    Partial<
      Pick<StrategyService, "bindOnchain" | "recover" | "restore">
    >;
  proofRuns?: Pick<ProofRunService, "run">;
  purchaseAudit?: Pick<PurchaseAuditService, "capture" | "read">;
  purchaseHistory?: Pick<PurchaseHistoryService, "list">;
  saleAudit?: Pick<SaleAuditService, "capture" | "list">;
  portfolio?: Pick<PortfolioService, "read">;
  walletReadiness?: Pick<WalletReadinessService, "read">;
  walletSwaps?: Pick<WalletSwapService, "build" | "quote">;
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
  const ensPolicyPreparation =
    dependencies.ensPolicyPreparation ??
    new EnsPolicyPreparationService(config, {
      controlPlane: ensControlPlane,
    });
  const fleetActivation =
    dependencies.fleetActivation ??
    new FleetActivationService(config, { controlPlane: ensControlPlane });
  const oneclawFleet =
    dependencies.oneclawFleet ?? new OneClawFleetProvisioner(config);
  const graphEvidence =
    dependencies.graphEvidence ?? new GraphEvidenceService(config);
  const uniswapRwaMarket =
    dependencies.uniswapRwaMarket ?? new UniswapRwaMarketService(config);
  const goals =
    dependencies.goals ??
    new AutonomousGoalService(
      new OpportunityAnalysisService(config, {
        catalog: stockCatalog,
        controlPlane: ensControlPlane,
      }),
      {
        oneclawMinimumAmount:
          config.EQLTY_ONECLAW_MIN_AMOUNT_USDG,
        oneclawLiveAuthorization:
          config.EQLTY_ONECLAW_LIVE_AUTHORIZATION,
        store: new FirestoreGoalStore(config),
        decisionFees: new DecisionFeeService(config),
      },
    );
  const strategyStore = new StrategyStore();
  const strategies =
    dependencies.strategies ??
    new StrategyService(config, strategyStore, {
      catalog: stockCatalog,
    });
  const proofRuns =
    dependencies.proofRuns ??
    new ProofRunService(config, strategyStore, {
      catalog: stockCatalog,
      controlPlane: ensControlPlane,
      executor: new EqltyVaultExecutor(config),
    });
  const purchaseAudit =
    dependencies.purchaseAudit ?? new PurchaseAuditService(config);
  const purchaseHistory =
    dependencies.purchaseHistory ??
    new PurchaseHistoryService(config, { catalog: stockCatalog });
  const saleAudit =
    dependencies.saleAudit ??
    new SaleAuditService(config, { graph: graphEvidence });
  const portfolio =
    dependencies.portfolio ??
    new PortfolioService(config, {
      history: purchaseHistory,
      catalog: stockCatalog,
    });
  const walletReadiness =
    dependencies.walletReadiness ?? new WalletReadinessService(config);
  const walletSwaps =
    dependencies.walletSwaps ??
    new WalletSwapService(config, { catalog: stockCatalog });

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

  app.get("/api/config", async (_request, response) => {
    response.setHeader("cache-control", "no-store");
    const [graphStatus, oneclawStatus] = await Promise.all([
      graphEvidence.status ? graphEvidence.status() : undefined,
      oneclawFleet.status ? oneclawFleet.status() : undefined,
    ]);
    response.json(publicConfig(config, graphStatus, oneclawStatus));
  });

  app.get("/api/wallet/readiness", async (request, response) => {
    const session = ownerAuth.session(request);
    if (!session) {
      return response
        .status(401)
        .json({ error: "owner_session_required" });
    }
    const parsed = uint256.safeParse(request.query.amountIn);
    if (!parsed.success) {
      return response.status(400).json({
        error: "invalid_purchase_amount",
        issues: parsed.error.issues,
      });
    }
    try {
      response.setHeader("cache-control", "no-store");
      return response.json(
        await walletReadiness.read(
          session.walletAddress,
          parsed.data,
        ),
      );
    } catch (error) {
      return response.status(503).json({
        error: "wallet_readiness_unavailable",
        message: safeMessage(error),
      });
    }
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

  app.post("/api/orchestration/prepare", async (request, response) => {
    const session = ownerAuth.session(request);
    if (!session) {
      return response
        .status(401)
        .json({ error: "owner_session_required" });
    }
    const parsed = ensPolicyChange.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({
        error: "invalid_ens_policy_change",
        issues: parsed.error.issues,
      });
    }
    try {
      response.setHeader("cache-control", "no-store");
      return response.json(
        await ensPolicyPreparation.prepare({
          userId: session.fleetUserId,
          owner: session.walletAddress,
          change: parsed.data,
        }),
      );
    } catch (error) {
      return response.status(409).json({
        error: "ens_policy_change_rejected",
        message: safeMessage(error),
      });
    }
  });

  app.post("/api/orchestration/apply-demo", async (request, response) => {
    if (!config.DEMO_MODE) {
      return response
        .status(403)
        .json({ error: "demo_policy_updates_disabled" });
    }
    const session = ownerAuth.session(request);
    if (!session) {
      return response
        .status(401)
        .json({ error: "owner_session_required" });
    }
    const parsed = ensPolicyChange.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({
        error: "invalid_ens_policy_change",
        issues: parsed.error.issues,
      });
    }
    if (!ensPolicyPreparation.publish) {
      return response
        .status(503)
        .json({ error: "ens_policy_publication_unavailable" });
    }
    try {
      response.setHeader("cache-control", "no-store");
      return response.json(
        await ensPolicyPreparation.publish({
          userId: session.fleetUserId,
          owner: session.walletAddress,
          change: parsed.data,
        }),
      );
    } catch (error) {
      return response.status(409).json({
        error: "ens_policy_publication_rejected",
        message: safeMessage(error),
      });
    }
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

  app.post(
    "/api/fleet/security/oneclaw",
    async (request, response) => {
      const session = ownerAuth.session(request);
      if (!session) {
        return response
          .status(401)
          .json({ error: "owner_session_required" });
      }
      const perkosIdToken = ownerAuth.perkosIdToken?.(request);
      if (!perkosIdToken) {
        return response.status(401).json({
          error: "perkos_session_required",
        });
      }
      if (!oneclawFleet.ready) {
        return response.status(503).json({
          error: "oneclaw_not_configured",
        });
      }
      const parsed = oneclawPlatformInput.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({
          error: "invalid_oneclaw_account",
          issues: parsed.error.issues,
        });
      }
      try {
        const activation = await fleetActivation.activate({
          userId: session.fleetUserId,
          owner: session.walletAddress,
          perkosIdToken,
        });
        const security: OneClawFleetSecurity =
          await oneclawFleet.provision({
            userId: session.fleetUserId,
            externalSubject: session.sub,
            email: parsed.data.email,
            perkosIdToken,
            agents: activation.runtime.agents,
          });
        response.setHeader("cache-control", "no-store");
        return response
          .status(security.status === "linked" ? 200 : 202)
          .json(security);
      } catch (error) {
        return response.status(503).json({
          error: "oneclaw_provisioning_failed",
          message: safeMessage(error),
        });
      }
    },
  );

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

  app.get("/api/fleet/policy", async (request, response) => {
    const session = ownerAuth.session(request);
    if (!session) {
      return response
        .status(401)
        .json({ error: "owner_session_required" });
    }

    const controlPlane = await ensControlPlane.resolve({
      userId: session.fleetUserId,
      owner: session.walletAddress,
    });
    if (
      controlPlane.status !== "active" ||
      !controlPlane.rootName ||
      !controlPlane.manifest ||
      !controlPlane.manifestHash
    ) {
      return response.status(503).json({
        error: "fleet_policy_unavailable",
        detail: controlPlane.error,
      });
    }

    response.setHeader("cache-control", "no-store");
    return response.json({
      schema: "urn:eqlty:ens-fleet-policy:v1",
      source: "durin",
      chainId: config.EQLTY_ENS_RECORDS_CHAIN_ID,
      rootName: controlPlane.rootName,
      manifestHash: controlPlane.manifestHash,
      resolvedAt: controlPlane.resolvedAt,
      version: controlPlane.manifest.version,
      paused: controlPlane.manifest.paused,
      allowedTickers: controlPlane.manifest.policy.allowedTickers,
      limits: {
        maxAmountPerTrade:
          controlPlane.manifest.policy.maxAmountPerTrade,
        maxDeviationBps:
          controlPlane.manifest.policy.maxDeviationBps,
        minLiquidityUsd:
          controlPlane.manifest.policy.minLiquidityUsd,
        maxOracleAgeSeconds:
          controlPlane.manifest.policy.maxOracleAgeSeconds,
      },
    });
  });

  app.get("/api/evidence/:ticker", async (request, response) => {
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
      const perkosIdToken = ownerAuth.perkosIdToken?.(request);
      const activation = await fleetActivation.activate({
        userId: session.fleetUserId,
        owner: session.walletAddress,
        perkosIdToken,
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
          fleetAgents: activation.runtime?.agents,
          perkosIdToken,
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

  app.post(
    "/api/goals/:id/decision-fee",
    async (request, response) => {
      const session = ownerAuth.session(request);
      if (!session) {
        return response
          .status(401)
          .json({ error: "owner_session_required" });
      }
      const parsedId = goalId.safeParse(request.params.id);
      const parsedPayment = decisionFeePayment.safeParse(request.body);
      if (!parsedId.success || !parsedPayment.success) {
        return response.status(400).json({
          error: "invalid_decision_fee_payment",
          issues: [
            ...(parsedId.success ? [] : parsedId.error.issues),
            ...(parsedPayment.success
              ? []
              : parsedPayment.error.issues),
          ],
        });
      }
      if (!goals.settleFee) {
        return response
          .status(503)
          .json({ error: "decision_fee_unavailable" });
      }
      try {
        const goal = await goals.settleFee(parsedId.data, {
          userId: session.fleetUserId,
          owner: session.walletAddress,
          perkosIdToken: ownerAuth.perkosIdToken?.(request),
          payment:
            parsedPayment.data as DecisionFeePaymentPayload,
        });
        if (!goal) {
          return response
            .status(404)
            .json({ error: "goal_not_found" });
        }
        response.setHeader("cache-control", "no-store");
        return response.json(goal);
      } catch (error) {
        return response.status(402).json({
          error: "decision_fee_settlement_failed",
          message: safeMessage(error),
        });
      }
    },
  );

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
      perkosIdToken: ownerAuth.perkosIdToken?.(request),
    });
    if (!goal) {
      return response.status(404).json({ error: "goal_not_found" });
    }
    response.setHeader("cache-control", "no-store");
    return response.json(goal);
  }

  app.post("/api/strategies", async (request, response) => {
    const session = ownerAuth.session(request);
    if (!session) {
      return response
        .status(401)
        .json({ error: "owner_session_required" });
    }
    const parsed = strategyInput.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({
        error: "invalid_strategy",
        issues: parsed.error.issues,
      });
    }
    if (
      parsed.data.owner.toLowerCase() !==
      session.walletAddress.toLowerCase()
    ) {
      return response.status(403).json({ error: "strategy_owner_mismatch" });
    }
    try {
      response.setHeader("cache-control", "no-store");
      return response.status(201).json(
        await strategies.create({
          owner: session.walletAddress,
          agent: (
            executionTraderAddress(config) ??
            session.walletAddress
          ) as `0x${string}`,
          ticker: parsed.data.ticker,
          inputToken: parsed.data.inputToken as `0x${string}`,
          outputToken: parsed.data.outputToken as `0x${string}`,
          router: parsed.data.router as `0x${string}`,
          maxAmountPerTrade: parsed.data.maxAmountPerTrade,
          maxTotalSpend: parsed.data.maxTotalSpend,
          maxSlippageBps: parsed.data.maxSlippageBps,
          expiresAt: parsed.data.expiresAt,
        }),
      );
    } catch (error) {
      return response.status(400).json({
        error: "strategy_rejected",
        message: safeMessage(error),
      });
    }
  });

  app.post(
    "/api/strategies/:id/onchain",
    async (request, response) => {
      const session = ownerAuth.session(request);
      if (!session) {
        return response
          .status(401)
          .json({ error: "owner_session_required" });
      }
      const parsedId = goalId.safeParse(request.params.id);
      const parsed = onchainStrategyInput.safeParse(request.body);
      if (!parsedId.success || !parsed.success) {
        return response.status(400).json({
          error: "invalid_onchain_strategy",
          issues: [
            ...(parsedId.success ? [] : parsedId.error.issues),
            ...(parsed.success ? [] : parsed.error.issues),
          ],
        });
      }
      if (!strategies.bindOnchain) {
        return response.status(503).json({
          error: "strategy_link_unavailable",
        });
      }
      try {
        response.setHeader("cache-control", "no-store");
        return response.json(
          await strategies.bindOnchain(
            parsedId.data,
            session.walletAddress,
            parsed.data,
          ),
        );
      } catch (error) {
        return response.status(400).json({
          error: "strategy_link_rejected",
          message: safeMessage(error),
        });
      }
    },
  );

  app.post(
    "/api/strategies/:id/recover",
    async (request, response) => {
      const session = ownerAuth.session(request);
      if (!session) {
        return response
          .status(401)
          .json({ error: "owner_session_required" });
      }
      const parsedId = goalId.safeParse(request.params.id);
      const parsed = executionStrategyInput.safeParse(request.body);
      if (!parsedId.success || !parsed.success) {
        return response.status(400).json({
          error: "invalid_strategy_recovery",
        });
      }
      if (!strategies.restore || !strategies.recover) {
        return response.status(503).json({
          error: "strategy_recovery_unavailable",
        });
      }
      try {
        await strategies.restore(
          parsed.data as ExecutionStrategy,
          session.walletAddress,
        );
        const recovered = await strategies.recover(
          parsedId.data,
          session.walletAddress,
        );
        response.setHeader("cache-control", "no-store");
        return recovered
          ? response.json(recovered)
          : response.status(204).send();
      } catch (error) {
        return response.status(400).json({
          error: "strategy_recovery_rejected",
          message: safeMessage(error),
        });
      }
    },
  );

  app.post("/api/runs", async (request, response) => {
    const session = ownerAuth.session(request);
    if (!session) {
      return response
        .status(401)
        .json({ error: "owner_session_required" });
    }
    const parsed = runInput.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({
        error: "invalid_run",
        issues: parsed.error.issues,
      });
    }
    try {
      if (parsed.data.strategy && strategies.restore) {
        await strategies.restore(
          parsed.data.strategy as ExecutionStrategy,
          session.walletAddress,
        );
      }
      const perkosIdToken = ownerAuth.perkosIdToken?.(request);
      const activation = await fleetActivation.activate({
        userId: session.fleetUserId,
        owner: session.walletAddress,
        perkosIdToken,
      });
      if (activation.status === "provisioning") {
        throw new Error("The Hermes fleet is still provisioning");
      }
      const linkedRoles =
        activation.runtime?.agents
          .filter((agent) => agent.oneclaw === "linked")
          .map((agent) => agent.role) ?? [];
      const requiredRoles = ["trader"] as const;
      const oneclaw = oneClawGate({
        amountIn: parsed.data.amountIn,
        linkedRoles,
        requiredRoles,
        minimumAmount: config.EQLTY_ONECLAW_MIN_AMOUNT_USDG,
        liveAuthorization:
          config.EQLTY_ONECLAW_LIVE_AUTHORIZATION,
      });
      response.setHeader("cache-control", "no-store");
      const run = await proofRuns.run({
        strategyId: parsed.data.strategyId,
        amountIn: parsed.data.amountIn,
        execute: parsed.data.execute,
        userId: session.fleetUserId,
        owner: session.walletAddress,
        oneclaw,
      });
      if (run.status === "executed" && run.transactionHash) {
        const strategy = strategyStore.strategy(
          parsed.data.strategyId,
          session.walletAddress,
        );
        if (!perkosIdToken || !strategy) {
          run.audit = {
            status: "failed",
            error: "PerkOS audit session is unavailable",
          };
        } else {
          try {
            const bundle = await purchaseAudit.capture({
              owner: session.walletAddress,
              idToken: perkosIdToken,
              run,
              strategy,
            });
            run.audit = {
              status: "stored",
              documentId: bundle.transactionHash.toLowerCase().slice(2),
              bundleHash: bundle.bundleHash,
            };
          } catch (error) {
            run.audit = {
              status: "failed",
              error: safeMessage(error),
            };
          }
        }
      }
      return response.status(201).json(run);
    } catch (error) {
      return response.status(503).json({
        error: "proof_run_failed",
        message: safeMessage(error),
      });
    }
  });

  app.get("/api/history", async (request, response) => {
    const session = ownerAuth.session(request);
    if (!session) {
      return response
        .status(401)
        .json({ error: "owner_session_required" });
    }
    try {
      response.setHeader("cache-control", "no-store");
      const idToken = ownerAuth.perkosIdToken?.(request);
      const [purchases, sales] = await Promise.all([
        purchaseHistory.list(session.walletAddress),
        idToken
          ? saleAudit.list(session.walletAddress, idToken)
          : Promise.resolve({ entries: [] }),
      ]);
      return response.json({ ...purchases, sales: sales.entries });
    } catch (error) {
      return response.status(503).json({
        error: "purchase_history_unavailable",
        message: safeMessage(error),
      });
    }
  });

  app.get("/api/audits/:transactionHash", async (request, response) => {
    const session = ownerAuth.session(request);
    if (!session) {
      return response
        .status(401)
        .json({ error: "owner_session_required" });
    }
    const parsedHash = transactionHash.safeParse(
      request.params.transactionHash,
    );
    const perkosIdToken = ownerAuth.perkosIdToken?.(request);
    if (!parsedHash.success) {
      return response.status(400).json({
        error: "invalid_transaction_hash",
      });
    }
    if (!perkosIdToken) {
      return response.status(503).json({
        error: "audit_session_unavailable",
      });
    }
    try {
      response.setHeader("cache-control", "no-store");
      const bundle = await purchaseAudit.read(
        session.walletAddress,
        perkosIdToken,
        parsedHash.data,
      );
      return bundle
        ? response.json(bundle)
        : response.status(404).json({ error: "audit_bundle_not_found" });
    } catch (error) {
      return response.status(503).json({
        error: "audit_bundle_unavailable",
        message: safeMessage(error),
      });
    }
  });

  app.get("/api/portfolio", async (request, response) => {
    const session = ownerAuth.session(request);
    if (!session) {
      return response
        .status(401)
        .json({ error: "owner_session_required" });
    }
    try {
      response.setHeader("cache-control", "no-store");
      return response.json(await portfolio.read(session.walletAddress));
    } catch (error) {
      return response.status(503).json({
        error: "portfolio_unavailable",
        message: safeMessage(error),
      });
    }
  });

  app.post("/api/sells/audit", async (request, response) => {
    const session = ownerAuth.session(request);
    if (!session) {
      return response
        .status(401)
        .json({ error: "owner_session_required" });
    }
    const idToken = ownerAuth.perkosIdToken?.(request);
    if (!idToken) {
      return response.status(503).json({
        error: "sale_audit_session_unavailable",
      });
    }
    const parsed = saleAuditInput.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({
        error: "invalid_sale_audit",
        issues: parsed.error.issues,
      });
    }
    try {
      response.setHeader("cache-control", "no-store");
      return response.status(201).json(
        await saleAudit.capture({
          ...parsed.data,
          owner: session.walletAddress,
          idToken,
          tokenIn: parsed.data.tokenIn as `0x${string}`,
        } as CaptureSaleInput),
      );
    } catch (error) {
      return response.status(503).json({
        error: "sale_audit_failed",
        message: safeMessage(error),
      });
    }
  });

  app.post("/api/sells/quote", async (request, response) => {
    const session = ownerAuth.session(request);
    if (!session) {
      return response
        .status(401)
        .json({ error: "owner_session_required" });
    }
    const parsed = walletSellInput.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({
        error: "invalid_wallet_sale",
        issues: parsed.error.issues,
      });
    }
    try {
      response.setHeader("cache-control", "no-store");
      return response.json(
        await walletSwaps.quote({
          owner: session.walletAddress,
          ticker: parsed.data.ticker,
          tokenIn: parsed.data.tokenIn as `0x${string}`,
          amountIn: parsed.data.amountIn,
          maxSlippageBps: parsed.data.maxSlippageBps,
        }),
      );
    } catch (error) {
      return response.status(409).json({
        error: "wallet_sale_quote_failed",
        message: safeMessage(error),
      });
    }
  });

  app.post("/api/sells/swap", async (request, response) => {
    const session = ownerAuth.session(request);
    if (!session) {
      return response
        .status(401)
        .json({ error: "owner_session_required" });
    }
    const parsed = walletSellBuildInput.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({
        error: "invalid_wallet_sale_quote",
        issues: parsed.error.issues,
      });
    }
    try {
      response.setHeader("cache-control", "no-store");
      return response.json(
        await walletSwaps.build({
          owner: session.walletAddress,
          sell: {
            ...parsed.data.sell,
            tokenIn: parsed.data.sell.tokenIn as `0x${string}`,
            tokenOut: parsed.data.sell.tokenOut as `0x${string}`,
            approval: parsed.data.sell.approval as
              | import("./market-types.js").UniswapTransaction
              | undefined,
          },
          signature: parsed.data.signature as
            | `0x${string}`
            | undefined,
        }),
      );
    } catch (error) {
      return response.status(409).json({
        error: "wallet_sale_build_failed",
        message: safeMessage(error),
      });
    }
  });

  app.get("/api/assets/series", async (request, response) => {
    const parsed = z
      .array(normalizedTicker)
      .min(1)
      .max(24)
      .safeParse(
        String(request.query.tickers ?? "")
          .split(",")
          .filter(Boolean),
      );
    if (!parsed.success) {
      return response.status(400).json({ error: "invalid_tickers" });
    }
    try {
      if (!graphEvidence.series) {
        throw new Error("The Graph series provider is not configured");
      }
      response.setHeader("cache-control", "no-store");
      return response.json(
        await graphEvidence.series([...new Set(parsed.data)]),
      );
    } catch (error) {
      return response.status(503).json({
        error: "graph_series_unavailable",
        message: safeMessage(error),
      });
    }
  });

  app.get("/api/assets/history", async (request, response) => {
    const parsed = z
      .array(normalizedTicker)
      .min(1)
      .max(96)
      .safeParse(
        String(request.query.tickers ?? "")
          .split(",")
          .filter(Boolean),
      );
    if (!parsed.success) {
      return response.status(400).json({ error: "invalid_tickers" });
    }
    try {
      response.setHeader("cache-control", "public, max-age=300");
      return response.json(
        await uniswapRwaMarket.series([...new Set(parsed.data)]),
      );
    } catch (error) {
      return response.status(503).json({
        error: "uniswap_rwa_history_unavailable",
        message: safeMessage(error),
      });
    }
  });

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

export default createApp(loadConfig());
