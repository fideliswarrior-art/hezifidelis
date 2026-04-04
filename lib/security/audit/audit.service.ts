import { db } from "../../db.js";
import { getClientIp } from "../utils/get-ip.js";

export type AuditLogPayload = {
  userId: string;
  action: string;
  entity: string;
  entityId: string;
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
  metadata?: Record<string, any> | null;
};

/**
 * Registra uma ação sensível no sistema.
 * Implementa a rastreabilidade imutável exigida na Camada C12.
 */
export async function createAuditLog(payload: AuditLogPayload) {
  const ip = await getClientIp();

  return await db.auditLog.create({
    data: {
      userId: payload.userId,
      action: payload.action,
      entity: payload.entity,
      entityId: payload.entityId,
      ip,
      // Usando spread condicional para não passar 'undefined' explicitamente,
      // respeitando a regra 'exactOptionalPropertyTypes' do tsconfig.
      ...(payload.before && { before: payload.before }),
      ...(payload.after && { after: payload.after }),
      ...(payload.metadata && { metadata: payload.metadata }),
    },
  });
}