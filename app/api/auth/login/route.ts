import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/security/auth/password";
import { safeRoute } from "@/lib/security/wrappers/safe-route";
import { UnauthorizedError } from "@/lib/security/guards/require-auth";
import { createAuditLog } from "@/lib/security/audit/audit.service";
import { AuditEvent } from "@/lib/security/audit/audit.events";
import { emailSchema, passwordLoginSchema } from "@/lib/security/utils/validations";
import { generateTwoFactorSecret } from "@/lib/security/auth/two-factor";
import { SignJWT } from "jose"; // Usado para assinar o pre_auth_token

const LoginSchema = z.object({
  email: emailSchema,
  password: passwordLoginSchema,
});

const loginHandler = async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  const { email, password } = LoginSchema.parse(body);

  const user = await db.user.findUnique({ where: { email } });

  if (!user || !(await verifyPassword(user.password, password))) {
    if (user) {
      await createAuditLog({
        userId: user.id, action: AuditEvent.AUTH_LOGIN_FAILED, entity: "User", entityId: user.id,
      });
    }
    throw new UnauthorizedError("Credenciais inválidas.");
  }

  // Trava 1: Usuário inativo
  if (!user.isActive) {
    throw new UnauthorizedError("Conta desativada.");
  }

  // Trava 2: E-mail obrigatório para o sistema inteiro agora
  if (!user.emailVerified) {
    throw new UnauthorizedError("Você precisa confirmar seu e-mail antes de fazer login.");
  }

  // Gera o token provisório de 5 minutos (Pre-Auth)
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const preAuthToken = await new SignJWT({ userId: user.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);

  // Trava 3: Direcionamento do 2FA
  if (!user.isTwoFactorEnabled) {
    // É o primeiro login pós-confirmação de e-mail. Vamos forçar a ativação!
    const { secret: totpSecret, qrCodeDataUrl } = await generateTwoFactorSecret(user.email);
    
    // Salva o segredo temporário
    await db.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: totpSecret },
    });

    return NextResponse.json({
      requiresTwoFactor: true,
      intent: "setup",
      qrCode: qrCodeDataUrl,
      preAuthToken,
    });
  }

  // Já tem 2FA configurado, apenas peça o código
  return NextResponse.json({
    requiresTwoFactor: true,
    intent: "verify",
    preAuthToken,
  });
};

export const POST = safeRoute(loginHandler, { rateLimitBucket: "auth", checkCsrf: false });