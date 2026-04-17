import { db } from "@/lib/db";
import { getClientIp } from "@/lib/security/utils/get-ip";
import type { AuditEventType } from "./audit.events"; // DT-11: Importação da tipagem estrita

export type AuditLogPayload = {
  userId: string;
  action: AuditEventType; // DT-11: Travado para aceitar apenas eventos do catálogo oficial
  entity: string;
  entityId: string;
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
  metadata?: Record<string, any> | null | undefined;
  ip?: string | null;
};

/**
 * Registra uma ação sensível no sistema.
 * Implementa a rastreabilidade imutável exigida na Camada C12.
 */
export async function createAuditLog(payload: AuditLogPayload) {
  // Prioriza o IP passado no payload (útil para background jobs/scripts)
  // Se não vier, tenta buscar da request (tratando erro caso rode fora do contexto HTTP)
  const resolvedIp =
    payload.ip !== undefined
      ? payload.ip
      : await getClientIp().catch(() => null);

  return await db.auditLog.create({
    data: {
      userId: payload.userId,
      action: payload.action,
      entity: payload.entity,
      entityId: payload.entityId,
      ip: resolvedIp ?? null,
      // Usando spread condicional para não passar 'undefined' explicitamente,
      // respeitando a regra 'exactOptionalPropertyTypes' do tsconfig.
      ...(payload.before && { before: payload.before }),
      ...(payload.after && { after: payload.after }),
      ...(payload.metadata && { metadata: payload.metadata }),
    },
  });
}
