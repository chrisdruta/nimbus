import { createHash, randomBytes } from "node:crypto";

/** RFC 7636 code verifier/challenge pair (S256). */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function generateState(): string {
  return randomBytes(32).toString("base64url");
}
