export function wasDecisionExecuted(owner: string, goalId: string): boolean {
  return window.localStorage.getItem(executedKey(owner, goalId)) === "1";
}

export function markDecisionExecuted(owner: string, goalId: string): void {
  window.localStorage.setItem(executedKey(owner, goalId), "1");
}

function executedKey(owner: string, goalId: string): string {
  return `eqlty:executed-decision:${owner.toLowerCase()}:${goalId}`;
}
