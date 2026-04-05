import { db } from "../../db";

/**
 * Adiciona o ID único de um token (JTI) à lista de revogação.
 */
export async function blacklistToken(jti: string, expiresAt: Date) {
  await db.blacklistedToken.upsert({
    where: { jti },
    update: {},
    create: { jti, expiresAt },
  });
}

/**
 * Verifica se um token foi revogado prematuramente.
 */
export async function isTokenBlacklisted(jti: string): Promise<boolean> {
  const token = await db.blacklistedToken.findUnique({
    where: { jti },
    select: { id: true } 
  });
  
  return token !== null;
}