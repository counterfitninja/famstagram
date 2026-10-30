import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";

export function nativeProofHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function createNativeGrant(userId: string, challenge: string) {
  const code = randomBytes(32).toString("hex");
  await db.nativeLoginGrant.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  await db.nativeLoginGrant.create({
    data: { codeHash: nativeProofHash(code), challenge, userId, expiresAt: new Date(Date.now() + 60_000) },
  });
  return code;
}

/** A grant is bound to the initiating app's proof and is consumed only once. */
export async function consumeNativeGrant(code: string, verifier: string) {
  return db.$transaction(async (tx) => {
    const codeHash = nativeProofHash(code);
    const grant = await tx.nativeLoginGrant.findUnique({ where: { codeHash }, include: { user: true } });
    if (!grant || grant.expiresAt <= new Date() || grant.challenge !== nativeProofHash(verifier)) return null;
    const consumed = await tx.nativeLoginGrant.deleteMany({
      where: { codeHash, challenge: nativeProofHash(verifier), expiresAt: { gt: new Date() } },
    });
    return consumed.count === 1 ? grant.user : null;
  });
}
