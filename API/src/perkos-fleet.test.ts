import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import { PerkosFleetService } from "./perkos-fleet.js";

const owner = "0x1234567890abcdef1234567890abcdef12345678" as const;
const input = {
  owner,
  userId: "u-1234567890abcdef1234",
};

describe("PerkOS fleet", () => {
  it("returns a four role plan in preview mode", async () => {
    const fetchFn = vi.fn();
    const service = new PerkosFleetService(loadConfig({}), { fetchFn });

    const runtime = await service.activate(input);

    expect(runtime).toMatchObject({
      provider: "perkos",
      mode: "preview",
      status: "planned",
    });
    expect(runtime.agents.map((agent) => agent.role)).toEqual([
      "scout",
      "risk",
      "trader",
      "auditor",
    ]);
    expect(runtime.agents[0]?.name).toBe("eqlty-scout-12345678");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("requires an owner token in live mode", async () => {
    const service = new PerkosFleetService(
      loadConfig({ PERKOS_FLEET_MODE: "live" }),
    );

    await expect(service.activate(input)).rejects.toThrow(
      "PerkOS wallet authentication is required",
    );
  });

  it("launches every missing Hermes role", async () => {
    const fetchFn = fleetApi([]);
    const service = new PerkosFleetService(
      loadConfig({ PERKOS_FLEET_MODE: "live" }),
      { fetchFn },
    );

    const runtime = await service.activate({
      ...input,
      idToken: "owner-id-token",
    });

    expect(runtime).toMatchObject({
      mode: "live",
      status: "provisioning",
      imageTag: "hermes-public-1",
    });
    expect(runtime.agents).toHaveLength(4);
    expect(
      runtime.agents.every((agent) => agent.state === "provisioning"),
    ).toBe(true);

    const launchCalls = fetchFn.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith("/agents/launch") &&
        (init as RequestInit).method === "POST",
    );
    expect(launchCalls).toHaveLength(4);
    const traderBody = launchCalls
      .map((call) => JSON.parse(String((call[1] as RequestInit).body)))
      .find((body) => body.name.includes("trader"));
    expect(traderBody).toMatchObject({
      runtime: "Hermes",
      deployMode: "perkos-managed",
      disabledTools: ["code-execution"],
      plugins: ["EQLTY-Uniswap-Plugin", "EQLTY-ENS-Plugin"],
    });
  });

  it("wakes existing agents and reads 1Claw status", async () => {
    const existing = [
      {
        id: "agent-scout",
        name: "eqlty-scout-12345678",
        runtime: "Hermes",
        status: "ready",
        integrations: {
          oneclaw: { configured: true },
        },
      },
      {
        id: "agent-risk",
        name: "eqlty-risk-12345678",
        runtime: "Hermes",
        status: "ready",
      },
      {
        id: "agent-trader",
        name: "eqlty-trader-12345678",
        runtime: "Hermes",
        status: "ready",
      },
      {
        id: "agent-auditor",
        name: "eqlty-auditor-12345678",
        runtime: "Hermes",
        status: "ready",
      },
    ];
    const fetchFn = fleetApi(existing);
    const service = new PerkosFleetService(
      loadConfig({
        PERKOS_FLEET_MODE: "live",
        PERKOS_HERMES_IMAGE_TAG: "hermes-pinned",
      }),
      { fetchFn },
    );

    const runtime = await service.activate({
      ...input,
      idToken: "owner-id-token",
    });

    expect(runtime.status).toBe("ready");
    expect(runtime.imageTag).toBe("hermes-pinned");
    expect(runtime.agents[0]).toMatchObject({
      agentId: "agent-scout",
      state: "ready",
      oneclaw: "linked",
    });
    expect(
      fetchFn.mock.calls.filter(([url]) =>
        String(url).endsWith("/ensure-awake"),
      ),
    ).toHaveLength(4);
    expect(
      fetchFn.mock.calls
        .filter(([url]) => String(url).endsWith("/ensure-awake"))
        .every(([, init]) =>
          String((init as RequestInit).body).includes(
            '"waitForRunning":false',
          ),
        ),
    ).toBe(true);
    expect(
      fetchFn.mock.calls.some(([url]) => String(url).endsWith("/runtimes")),
    ).toBe(false);
  });

  it("does not replace an incompatible existing runtime", async () => {
    const fetchFn = fleetApi([
      {
        id: "wrong-runtime",
        name: "eqlty-scout-12345678",
        runtime: "OpenClaw",
        status: "ready",
      },
    ]);
    const service = new PerkosFleetService(
      loadConfig({
        PERKOS_FLEET_MODE: "live",
        PERKOS_HERMES_IMAGE_TAG: "hermes-pinned",
      }),
      { fetchFn },
    );

    const runtime = await service.activate({
      ...input,
      idToken: "owner-id-token",
    });

    expect(runtime.status).toBe("partial");
    expect(runtime.agents[0]).toMatchObject({
      agentId: "wrong-runtime",
      state: "failed",
    });
  });

  it("preserves the PerkOS infrastructure payment error", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith("/agents")) {
        return Response.json({ agents: [] });
      }
      return Response.json(
        {
          error: {
            code: "INFRA_PAYMENT_REQUIRED",
            message: "Payment is required before using managed infrastructure.",
          },
        },
        { status: 402 },
      );
    });
    const service = new PerkosFleetService(
      loadConfig({
        PERKOS_FLEET_MODE: "live",
        PERKOS_HERMES_IMAGE_TAG: "hermes-pinned",
      }),
      { fetchFn },
    );

    await expect(
      service.activate({ ...input, idToken: "owner-id-token" }),
    ).rejects.toMatchObject({
      status: 402,
      code: "INFRA_PAYMENT_REQUIRED",
      message: "Payment is required before using managed infrastructure.",
    });
  });
});

function fleetApi(existing: unknown[]) {
  return vi.fn(async (
    input: URL | string | Request,
    init: RequestInit = {},
  ) => {
    const url = String(input);
    const authorization = new Headers(init.headers).get("authorization");
    if (url.endsWith("/runtimes")) {
      return Response.json({
        runtimes: [
          {
            runtime: "Hermes",
            channel: "public",
            primaryTag: "hermes-public-1",
          },
        ],
      });
    }
    if (url.endsWith("/agents") && init.method !== "POST") {
      expect(authorization).toBe("Bearer owner-id-token");
      return Response.json({ agents: existing });
    }
    if (url.endsWith("/ensure-awake")) {
      expect(authorization).toBe("Bearer owner-id-token");
      return Response.json({ state: "ready", woke: false });
    }
    if (url.endsWith("/agents/launch")) {
      expect(authorization).toBe("Bearer owner-id-token");
      const body = JSON.parse(String(init.body)) as { name: string };
      return Response.json({
        launchId: `launch-${body.name}`,
        result: {
          status: "provisioning",
          jobId: `job-${body.name}`,
        },
      });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  });
}
