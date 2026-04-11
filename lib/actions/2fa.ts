"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { safeAction } from "@/lib/security/wrappers/safe-action";
import { generateTwoFactorSecret, verifyTwoFactorToken } from "@/lib/security/auth/two-factor";
import { createAuditLog } from "@/lib/security/audit/audit.service";
import { AuditEvent } from "@/lib/security/audit/audit.events";
import { UnauthorizedError } from "@/lib/security/guards/require-auth";

// 1. Action de Inicialização (Gera o QR Code)
export const setupTwoFactor = async () => {
  return safeAction({
    requireAuth: true,       // Apenas usuários logados
    rateLimitBucket: "auth", // Proteção contra spam de geração (5 req/min)
  }, async (_, session) => {
    // O safeAction garante que a session existe
    if (!session) throw new UnauthorizedError();

    const user = await db.user.findUnique({ where: { id: session.userId } });
    
    if (!user) {
      throw new UnauthorizedError("Usuário não encontrado.");
    }

    if (user.isTwoFactorEnabled) {
      throw new Error("A autenticação em duas etapas já está ativada.");
    }

    // Gera o segredo provisório e as imagens
    const { secret, qrCodeDataUrl, uri } = await generateTwoFactorSecret(user.email);

    // Salva o segredo no banco, mas AINDA NÃO ATIVA a trava (isTwoFactorEnabled fica false)
    await db.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: secret },
    });

    return { qrCodeDataUrl, uri };
  });
};


// 2. Schema de validação para a Confirmação
const Confirm2FASchema = z.object({
  token: z.string().length(6, "O código deve ter exatamente 6 dígitos."),
});

// 3. Action de Confirmação (Efetiva a trava de segurança)
export const confirmTwoFactor = async (dados: unknown) => {
  return safeAction({
    schema: Confirm2FASchema, // Anti mass-assignment
    requireAuth: true,
    rateLimitBucket: "auth",
  }, async (parsedInput, session) => {
    if (!session) throw new UnauthorizedError();

    const user = await db.user.findUnique({ where: { id: session.userId } });
    
    if (!user || !user.twoFactorSecret) {
      throw new Error("O processo de configuração do 2FA não foi iniciado.");
    }

    if (user.isTwoFactorEnabled) {
      throw new Error("A autenticação em duas etapas já está ativada.");
    }

    // Valida o código inserido contra o segredo provisório
    const isValid = verifyTwoFactorToken(user.twoFactorSecret, parsedInput.token);

    if (!isValid) {
      throw new Error("Código inválido ou expirado. Tente novamente.");
    }

    // Ativa a trava permanentemente
    await db.user.update({
      where: { id: user.id },
      data: { isTwoFactorEnabled: true },
    });

    // Registra a ativação na trilha de auditoria
    await createAuditLog({
      userId: user.id,
      action: AuditEvent.USER_PROFILE_UPDATE,
      entity: "User",
      entityId: user.id,
      metadata: { reason: "Autenticação em 2 fatores (2FA) habilitada com sucesso." },
    });

    return { success: true, message: "Autenticação em duas etapas ativada com sucesso!" };
  }, dados);
};