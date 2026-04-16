"use server";

import { z } from "zod";
import { safeAction } from "@/lib/security/wrappers/safe-action";
import {
  getAuditLogs,
  getAuditLogById,
  type AuditLogFilterParams,
} from "@/lib/services/audit/audit-query.service";
import { createAuditLog } from "@/lib/security/audit/audit.service";
import { AuditEvent } from "@/lib/security/audit/audit.events";
import { Role } from "@prisma/client";

/**
 * ============================================================================
 * SERVER ACTIONS: Dashboard de Auditoria (Onda 2 - E2.4)
 * ============================================================================
 * * OBJETIVO:
 * Expor as funcionalidades de consulta de logs para o frontend de forma segura.
 * * PROTEÇÕES APLICADAS (Camada C3, C11, C12):
 * 1. safeAction: Garante proteção CSRF, Rate Limit e tratamento de erros.
 * 2. requireRole: Apenas usuários com papel 'ADMIN' ou superior podem executar.
 * 3. Validação Zod: Filtros são validados e formatados antes do banco.
 * 4. Meta-Auditoria: A abertura de detalhes de um log gera um rastro (AUDIT_READ).
 * ============================================================================
 */

// Schema Zod correspondente a AuditLogFilterParams
const auditFilterSchema = z.object({
  userId: z.string().optional(),
  action: z.string().optional(),
  entity: z.string().optional(),
  entityId: z.string().optional(),
  ip: z.string().optional(),
  dateFrom: z.date().optional(),
  dateTo: z.date().optional(),
  cursor: z.string().optional(),
  take: z.number().min(1).max(100).default(50),
}) satisfies z.ZodType<AuditLogFilterParams>;

/**
 * Action para listar logs de auditoria com paginação e filtros.
 * Protegida nativamente pelo wrapper para a Role ADMIN.
 */
export async function getAuditLogsAction(rawInput: unknown) {
  return safeAction(
    {
      schema: auditFilterSchema,
      requireRole: Role.ADMIN, // Trava de segurança (Camada C3)
    },
    async (parsedInput) => {
      // Repassa os filtros validados para a camada de serviço
      return await getAuditLogs(parsedInput);
    },
    rawInput,
  );
}

/**
 * Action para obter o detalhe de um log específico.
 * Registra uma entrada de 'AUDIT_READ' no sistema (Meta-Auditoria).
 */
export async function getAuditLogDetailAction(rawInput: unknown) {
  return safeAction(
    {
      schema: z.object({ id: z.string() }),
      requireRole: Role.ADMIN, // Apenas Admins podem ver detalhes
    },
    async ({ id }, session) => {
      const log = await getAuditLogById(id);

      const userId = session?.userId;

      if (log && userId) {
        // Meta-Auditoria: Registramos que o admin leu um log (C12)
        await createAuditLog({
          userId: userId,
          action: AuditEvent.AUDIT_READ,
          entity: "AuditLog",
          entityId: id,
          metadata: {
            summary: `Visualizou detalhes do log ${id}`,
            accessedEntity: log.entity,
            accessedAction: log.action,
          },
        });
      }

      return log;
    },
    rawInput,
  );
}
