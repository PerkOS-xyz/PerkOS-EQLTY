import { describe, expect, it } from "vitest";
import { hasGraphAccess } from "./graph-adapter-auth.js";

const accessToken = "eqlty-graph-access-token-for-tests";

describe("Graph adapter access", () => {
  it("accepts the configured bearer token", () => {
    expect(hasGraphAccess(`Bearer ${accessToken}`, accessToken)).toBe(
      true,
    );
  });

  it("rejects missing or different credentials", () => {
    expect(hasGraphAccess(undefined, accessToken)).toBe(false);
    expect(hasGraphAccess("Basic credentials", accessToken)).toBe(
      false,
    );
    expect(
      hasGraphAccess("Bearer another-token", accessToken),
    ).toBe(false);
  });
});
