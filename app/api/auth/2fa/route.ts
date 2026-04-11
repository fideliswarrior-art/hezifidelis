import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { jwtVerify } from "jose";
import { db } from "@/lib/db";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { verifyTwoFactorToken } from "@/lib/security/auth/two-factor";
import { createSession } from "@/lib/security/auth/session";
import { createAuditLog } from "@/lib/security/audit/audit.service";
import { AuditEvent } from "@/lib/security/audit/audit.events";
import { UnauthorizedError } from "@/lib/security/guards/require-auth";

const TwoFactorSchema = z.object({
  code: z.string().length(6, "Código inválido."),
  preAuthToken: z.string(),
  intent: z.enum(["setup", "verify"]),
});

const twoFactorHandler = async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  const { code, preAuthToken, intent } = TwoFactorSchema.parse(body);

  // 1. Valida se o usuário passou pela Etapa 1 nos últimos 5 minutos
  let userId: string;
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const { payload } = await jwtVerify(preAuthToken, secret);
    userId = payload.userId as string;
  } catch (err) {
    throw new UnauthorizedError("Sessão de login expirada. Volte e digite sua senha novamente.");
  }

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive || !user.twoFactorSecret) {
    throw new UnauthorizedError("Acesso negado.");
  }

  // 2. Valida o TOTP
  const isValid = verifyTwoFactorToken(user.twoFactorSecret, code);
  if (!isValid) {
    throw new UnauthorizedError("Código 2FA incorreto ou expirado.");
  }

  // 3. Se a intenção for 'setup', nós finalmente travamos a conta com o 2FA habilitado
  if (intent === "setup" && !user.isTwoFactorEnabled) {
    await db.user.update({
      where: { id: user.id },
      data: { isTwoFactorEnabled: true },
    });
    
    await createAuditLog({
      userId: user.id, action: AuditEvent.USER_PROFILE_UPDATE, entity: "User", entityId: user.id,
      metadata: { reason: "2FA ativado obrigatoriamente no primeiro login." }
    });
  }

  // 4. Criação da Sliding Session! (Injeta os cookies HttpOnly de 15m e 7d)
  // A função createSession gerará os tokens e usará o NextResponse interno ou a API do Next.js cookies()
  await createSession({
    userId: user.id,
    role: user.role,
    tokenVersion: 0, 
  });

  await createAuditLog({
    userId: user.id, action: AuditEvent.AUTH_LOGIN, entity: "User", entityId: user.id,
  });

  return NextResponse.json({
    success: true,
    user: { id: user.id, name: user.name, role: user.role }
  });
};

export const POST = safeRoute(twoFactorHandler, { rateLimitBucket: "auth", checkCsrf: false });