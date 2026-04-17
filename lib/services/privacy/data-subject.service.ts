import { db } from "@/lib/db";
import { createAuditLog } from "@/lib/security/audit/audit.service";
import { AUDIT_EVENTS } from "@/lib/security/audit/audit.events";
import { randomUUID } from "crypto";
import { decryptField } from "@/lib/security/crypto/encryption"; // DT-09: Import para descriptografia
import { NotFoundError, DataSubjectError } from "@/lib/security/utils/errors"; // DT-10: Erros centralizados

/**
 * ============================================================================
 * MÓDULO: Direitos do Titular de Dados - LGPD (Onda 2 - E2.6)
 * ============================================================================
 * * OBJETIVO:
 * Atender aos Artigos 9º e 18º da LGPD, fornecendo os mecanismos de
 * Portabilidade (Exportação), Direito ao Esquecimento (Anonimização) e
 * Correção de Dados.
 * * * DECISÕES DE ARQUITETURA:
 * 1. Anonimização irreversível: O Direito ao Esquecimento não faz "DELETE" no
 * banco (pois isso quebraria a integridade financeira e de auditoria). Em vez
 * disso, embaralhamos os dados identificáveis (PII) permanentemente.
 * 2. Invalidação Imediata: Ao anonimizar, o `tokenVersion` é incrementado,
 * derrubando qualquer sessão JWT ativa na Camada C2.
 * 3. Inteligibilidade de Dados: Na exportação, campos criptografados em repouso
 * são descriptografados para o titular (DT-09).
 * ============================================================================
 */

/**
 * Exporta todos os dados vinculados a um usuário (Portabilidade).
 */
export async function exportUserData(userId: string) {
  // 1. Busca colossal: trazemos toda a árvore de dados do usuário
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      consents: true,
      notifications: true,
      donations: true,
      tickets: true,
      orders: { include: { items: true, payments: true } },
      comments: true,
      articleLikes: true,
      wishlistItems: true,
      productReviews: true,
      auditLogs: true,
    },
  });

  if (!user) {
    throw new NotFoundError("Usuário não encontrado.");
  }

  // 2. Higienização de Segurança (Data Sanitization)
  // Removemos dados que não devem ser exportados (hashes, segredos, etc.)
  const { password, twoFactorSecret, ...safeUser } = user;

  // DT-09: Descriptografar campos AES-256 (como holderDocument) para exportação inteligível
  // Usamos Promise.all para processar os tickets de forma eficiente
  const sanitizedTickets = await Promise.all(
    safeUser.tickets.map(async (ticket) => {
      // Descriptografa o documento do titular (se houver)
      const decryptedDoc = await decryptField(ticket.holderDocument);

      if (!ticket.isUsed) {
        // Se não usado, mascaramos o QR Code por segurança contra roubo físico
        const { qrCode, ...safeTicket } = ticket;
        return {
          ...safeTicket,
          holderDocument: decryptedDoc,
          qrCode: "[OCULTO_POR_SEGURANCA]",
        };
      }

      return {
        ...ticket,
        holderDocument: decryptedDoc,
      };
    }),
  );

  const exportPayload = {
    ...safeUser,
    tickets: sanitizedTickets,
    exportedAt: new Date().toISOString(),
  };

  // 3. Contagem de entidades para auditoria
  let entityCount = 0;
  for (const key in exportPayload) {
    if (Array.isArray(exportPayload[key as keyof typeof exportPayload])) {
      entityCount += (exportPayload[key as keyof typeof exportPayload] as any[])
        .length;
    }
  }

  // 4. Auditoria (DT-11: Removido 'as any' devido à correção na assinatura do AuditLog)
  await createAuditLog({
    userId,
    action: AUDIT_EVENTS.DATA_EXPORT,
    entity: "User",
    entityId: userId,
    metadata: { entityCount },
  });

  return exportPayload;
}

/**
 * Aplica o Direito ao Esquecimento (Anonimização irreversível).
 */
export async function anonymizeUser(
  userId: string,
  reason: string,
  actorId: string,
) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("Usuário não encontrado.");

  if (!user.isActive && user.name === "[ANONIMIZADO]") {
    throw new DataSubjectError(
      "Usuário já está anonimizado.",
      "ALREADY_ANONYMIZED",
    );
  }

  const anonUuid = randomUUID();
  const anonEmail = `anon-${anonUuid}@anonimizado.local`;

  // Execução atômica em transação para garantir que não haja anonimização parcial
  await db.$transaction(async (tx) => {
    // 1. Anonimiza a conta raiz
    await tx.user.update({
      where: { id: userId },
      data: {
        name: "[ANONIMIZADO]",
        email: anonEmail,
        avatarUrl: null,
        bio: null,
        isActive: false, // Soft delete
        tokenVersion: { increment: 1 }, // Invalida todas as sessões ativas
      },
    });

    // 2. Revoga todos os consentimentos ativos
    await tx.consent.updateMany({
      where: { userId, granted: true },
      data: {
        granted: false,
        revokedAt: new Date(),
      },
    });

    // 3. Apaga dados identificáveis de doações
    await tx.donation.updateMany({
      where: { userId },
      data: {
        donorName: null,
        donorEmail: null,
      },
    });

    // 4. Mascara o conteúdo de comentários públicos
    await tx.comment.updateMany({
      where: { authorId: userId },
      data: {
        content: "[conteúdo removido a pedido do titular]",
      },
    });
  });

  // 5. Auditoria (DT-11: Removido 'as any')
  await createAuditLog({
    userId: actorId,
    action: AUDIT_EVENTS.USER_ANONYMIZE,
    entity: "User",
    entityId: userId,
    metadata: { reason, targetUserId: userId },
  });

  return { success: true, message: "Conta anonimizada com sucesso." };
}

/**
 * Permite a correção de dados cadastrais não-críticos (Art. 18, III).
 */
export async function correctUserData(
  userId: string,
  data: { name?: string; bio?: string | null; avatarUrl?: string | null },
) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("Usuário não encontrado.");

  // Removemos chaves undefined para não sobescrever com null acidentalmente
  const updateData = Object.fromEntries(
    Object.entries(data).filter(([_, v]) => v !== undefined),
  );

  if (Object.keys(updateData).length === 0) {
    return user;
  }

  const updatedUser = await db.user.update({
    where: { id: userId },
    data: updateData,
  });

  // DT-11: Removido 'as any'
  await createAuditLog({
    userId,
    action: AUDIT_EVENTS.USER_DATA_CORRECT,
    entity: "User",
    entityId: userId,
    before: {
      name: user.name,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
    },
    after: updateData,
  });

  return updatedUser;
}
