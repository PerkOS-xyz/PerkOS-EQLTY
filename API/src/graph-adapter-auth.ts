import { timingSafeEqual } from "node:crypto";

export function hasGraphAccess(
  authorization: string | undefined,
  accessToken: string,
): boolean {
  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }

  const provided = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(accessToken);
  return (
    provided.length === expected.length &&
    timingSafeEqual(provided, expected)
  );
}
