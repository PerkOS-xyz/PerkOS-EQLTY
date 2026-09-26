import { describe, expect, it } from "vitest";
import { UpstreamBudget } from "./upstream-budget.js";

describe("upstream budget", () => {
  it("grants the limit within the window, then says when one frees up", () => {
    let now = 0;
    const budget = new UpstreamBudget(2, 60_000, () => now);

    expect(budget.take()).toBe(0);
    now = 10_000;
    expect(budget.take()).toBe(0);
    now = 30_000;
    expect(budget.take()).toBe(30);
    now = 59_500;
    expect(budget.take()).toBe(1);
  });

  it("frees each start once it leaves the window", () => {
    let now = 0;
    const budget = new UpstreamBudget(2, 60_000, () => now);
    budget.take();
    now = 10_000;
    budget.take();

    now = 60_000;
    expect(budget.take()).toBe(0);
    expect(budget.take()).toBe(10);
    now = 70_000;
    expect(budget.take()).toBe(0);
  });

  it("does not spend a refused start", () => {
    let now = 0;
    const budget = new UpstreamBudget(1, 60_000, () => now);
    budget.take();

    now = 30_000;
    expect(budget.take()).toBe(30);
    expect(budget.take()).toBe(30);
    now = 60_000;
    expect(budget.take()).toBe(0);
  });
});
