import { describe, expect, it } from "vitest";
import { publicErrorMessage } from "./public-error.js";

describe("public error messages", () => {
  it("keeps concise product errors", () => {
    expect(
      publicErrorMessage(new Error("ENS manifest has expired")),
    ).toBe("ENS manifest has expired");
  });

  it("replaces provider diagnostics with a safe message", () => {
    const message = publicErrorMessage(
      new Error(
        "Missing parameters. URL: https://rpc.example/key Request body: raw transaction 0x1234",
      ),
    );

    expect(message).toBe("The external provider rejected the request.");
    expect(message).not.toContain("rpc.example");
    expect(message).not.toContain("0x1234");
  });

  it("maps nonce collisions without returning transaction data", () => {
    const message = publicErrorMessage(
      new Error(
        "Request body: 0xdeadbeef Details: replacement transaction underpriced",
      ),
    );

    expect(message).toBe(
      "An ENS transaction is still settling. Retry after it confirms.",
    );
    expect(message).not.toContain("0xdeadbeef");
  });

  it("uses the supplied fallback for unknown values", () => {
    expect(publicErrorMessage(undefined, "Unavailable")).toBe(
      "Unavailable",
    );
  });
});
