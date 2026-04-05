import { NextResponse, type NextRequest } from "next/server";
import { safeRoute } from "../../../../lib/security/wrappers/safe-route.js";
import { getSession, clearSession, getRefreshTokenFromCookie } from "../../../../lib/security/auth/session.js";
import { verifyRefreshToken } from "../../../../lib/security/auth/token.js";
import { blacklistToken } from "../../../../lib/security/auth/blacklist.js";
import { createAuditLog } from "../../../../lib/security/audit/audit.service.js";
import { AuditEvent } from "../../../../lib/security/audit/audit.events.js";

const logoutHandler = async (req: NextRequest) => {
  const session = await getSession();
  const refreshToken = await getRefreshTokenFromCookie();

  // 1. Queima do Token na Blacklist
  if (refreshToken) {
    try {
      // Verificamos a assinatura PRIMEIRO. Isso impede ataques de Negação de Serviço (DoS)
      // onde alguém forjaria um token falso com o JTI de um admin para deslogá-lo.
      const payload = await verifyRefreshToken(refreshToken);
      
      if (payload.jti && payload.exp) {
        const expiresAt = new Date(payload.exp * 1000);
        await blacklistToken(payload.jti, expiresAt);
      }
    } catch (error) {
      // Se o token for inválido ou já expirou, a biblioteca 'jose' lança um erro.
      // Se já expirou, não precisamos fazer nada, pois ele já é inútil naturalmente.
    }
  }

  // 2. Auditoria
  if (session) {
    await createAuditLog({
      userId: session.userId,
      action: AuditEvent.AUTH_LOGOUT,
      entity: "User",
      entityId: session.userId,
    });
  }

  // 3. Destrói os cookies no cliente
  await clearSession();

  return NextResponse.json({ success: true, message: "Logout realizado com sucesso." });
};

export const POST = safeRoute(logoutHandler, { rateLimitBucket: "auth", checkCsrf: true });