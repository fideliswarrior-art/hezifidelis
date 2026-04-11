import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { getRefreshTokenFromCookie, createSession, clearSession } from "@/lib/security/auth/session";
import { verifyRefreshToken } from "@/lib/security/auth/token";
import { isTokenBlacklisted } from "@/lib/security/auth/blacklist";
import { createAuditLog } from "@/lib/security/audit/audit.service";
import { AuditEvent } from "@/lib/security/audit/audit.events";

const refreshHandler = async (req: NextRequest) => {
  const refreshToken = await getRefreshTokenFromCookie();

  if (!refreshToken) {
    return NextResponse.json({ error: "Refresh token ausente." }, { status: 401 });
  }

  try {
    // 1. Validação Criptográfica e Temporal
    const payload = await verifyRefreshToken(refreshToken);
    
    // 2. CHECAGEM NA BLACKLIST (Defesa contra replay de token roubado)
    const isBlacklisted = await isTokenBlacklisted(payload.jti);
    if (isBlacklisted) {
      await clearSession();
      return NextResponse.json({ error: "Sessão revogada." }, { status: 401 });
    }

    // 3. Busca o usuário
    const user = await db.user.findUnique({ where: { id: payload.userId } });

    if (!user || !user.isActive) {
      await clearSession();
      return NextResponse.json({ error: "Acesso negado." }, { status: 401 });
    }

    // 4. Invalidação Global via Token Version (ex: se trocou a senha em outro PC)
    if (user.tokenVersion !== payload.tokenVersion) {
      await clearSession();
      return NextResponse.json({ error: "Sessão invalidada em outro dispositivo." }, { status: 401 });
    }

    // 5. Sliding Session: Tudo limpo, emitimos uma nova via expressa para o usuário!
    await createSession({
      userId: user.id,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });

    await createAuditLog({
      userId: user.id,
      action: AuditEvent.AUTH_REFRESH,
      entity: "User",
      entityId: user.id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    await clearSession();
    return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  }
};

export const POST = safeRoute(refreshHandler, { rateLimitBucket: "auth", checkCsrf: true });