// Dev tool: mint a local-dev nimbus_session cookie for the owner so browser
// automation (playwright-cli) can exercise authed pages locally.
// Requires .env sourced (the react-server condition resolves the
// `server-only` marker in lib/server to its empty module):
//   set -a && . ./.env && set +a && bun --conditions=react-server tools/mint-session.ts
import { SignJWT } from "jose";
import { getUserByScId } from "../lib/server/db";

const SESSION_TTL_S = 7 * 24 * 60 * 60;

const secretRaw = process.env.SESSION_SECRET;
const ownerRaw = process.env.OWNER_SC_USER_ID;
if (!secretRaw || !ownerRaw) {
  console.error(
    "SESSION_SECRET and OWNER_SC_USER_ID must be set (source .env first)",
  );
  process.exit(1);
}

const owner = await getUserByScId(Number(ownerRaw));
if (!owner) {
  console.error(
    `No users row for OWNER_SC_USER_ID=${ownerRaw} — complete OAuth in production first`,
  );
  process.exit(1);
}

const token = await new SignJWT({
  userId: owner.id,
  scUserId: owner.sc_user_id,
  kind: "session",
})
  .setProtectedHeader({ alg: "HS256", typ: "JWT" })
  .setIssuer("nimbus")
  .setAudience("nimbus:session")
  .setIssuedAt()
  .setExpirationTime(`${SESSION_TTL_S}s`)
  .sign(new TextEncoder().encode(secretRaw));

console.log(token);
