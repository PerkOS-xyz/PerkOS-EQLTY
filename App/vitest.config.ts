import { defineConfig } from "vitest/config";

// Unit tests for the pure helpers in lib/. The pages are covered by e2e/.
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
