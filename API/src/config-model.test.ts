import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("agent LLM model", () => {
  it("defaults to kimi-k3", () => {
    expect(loadConfig({}).EQLTY_PERKOS_AGENT_LLM_MODEL).toBe("kimi-k3:cloud");
  });

  it("replaces a retired model with kimi-k3", () => {
    for (const retired of ["deepseek-v4-flash:cloud", "qwen3.5:cloud", "qwen3-coder-next:cloud", "qwen3-coder:480b-cloud"]) {
      expect(loadConfig({ EQLTY_PERKOS_AGENT_LLM_MODEL: retired }).EQLTY_PERKOS_AGENT_LLM_MODEL).toBe("kimi-k3:cloud");
    }
  });

  it("keeps any other model", () => {
    expect(loadConfig({ EQLTY_PERKOS_AGENT_LLM_MODEL: "gemma4:cloud" }).EQLTY_PERKOS_AGENT_LLM_MODEL).toBe("gemma4:cloud");
  });
});
