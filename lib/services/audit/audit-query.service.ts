import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

/**
 * ============================================================================
 * MÓDULO: Serviço de Consulta de Auditoria (Onda 2 - E2.4)
 * ============================================================================
 * * OBJETIVO:
 * Prover uma camada de busca otimizada e filtrada sobre o modelo AuditLog.
 * Essencial para a Camada C12 (Observabilidade), permitindo que o administrador
 * visualize a trilha imutável de ações sensíveis do sistema.
 * * * DECISÕES DE ARQUITETURA E SEGURANÇA:
 * 1. Paginação por Cursor: Diferente da paginação por 'offset' (page/limit),
 * o cursor mantém a performance constante mesmo quando o banco possui milhões
 * de logs, evitando o "Full Table Scan".
 * 2. Joins Controlados: Realizamos o include apenas do modelo User (Ator)
 * para exibir Nome/E-mail na tabela, minimizando o tráfego de dados.
 * 3. Filtros Dinâmicos: Suporta filtragem por Ator, Ação, Entidade,
 * Período e IP, atendendo aos requisitos da Seção 3.7.3 do Plano.
 * ============================================================================
 */

export type AuditLogFilterParams = {
  userId?: string | undefined;
  action?: string | undefined;
  entity?: string | undefined;
  entityId?: string | undefined;
  ip?: string | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
  cursor?: string | undefined; // ID do último registro da página anterior
  take?: number | undefined; // Quantidade por página (Padrão 50)
};

/**
 * Recupera uma lista paginada e filtrada de logs de auditoria.
 * * @param params Parâmetros de filtro e paginação.
 * @returns Lista de logs com metadados do Ator e cursor para a próxima página.
 */
export async function getAuditLogs(params: AuditLogFilterParams) {
  const {
    userId,
    action,
    entity,
    entityId,
    ip,
    dateFrom,
    dateTo,
    cursor,
    take = 50,
  } = params;

  // Construção dinâmica da cláusula WHERE respeitando a Matriz de Defesa
  const where: Prisma.AuditLogWhereInput = {
    ...(userId && { userId }),
    ...(action && { action }),
    ...(entity && { entity }),
    ...(entityId && { entityId }),
    ...(ip && { ip: { contains: ip } }),
    ...((dateFrom || dateTo) && {
      createdAt: {
        ...(dateFrom && { gte: dateFrom }),
        ...(dateTo && { lte: dateTo }),
      },
    }),
  };

  const logs = await db.auditLog.findMany({
    where,
    take: take + 1, // Pegamos um a mais para saber se existe próxima página
    // Solução para o exactOptionalPropertyTypes: Spread condicional
    ...(cursor && { cursor: { id: cursor } }),
    skip: cursor ? 1 : 0, // Pula o próprio cursor se ele existir
    orderBy: {
      createdAt: "desc", // Ordem cronológica inversa (mais recentes primeiro)
    },
    include: {
      user: {
        select: {
          name: true,
          email: true,
          role: true,
        },
      },
    },
  });

  // Lógica para determinar se há uma próxima página
  let nextCursor: string | undefined = undefined;
  if (logs.length > take) {
    const nextItem = logs.pop();
    nextCursor = nextItem?.id;
  }

  return {
    items: logs,
    nextCursor,
  };
}

/**
 * Recupera o detalhe completo de um log específico.
 * Utilizado para a visualização de 'before' e 'after' no dashboard.
 * * @param logId ID único do registro de auditoria.
 * @returns O log completo com Ator ou null se não encontrado.
 */
export async function getAuditLogById(logId: string) {
  return await db.auditLog.findUnique({
    where: { id: logId },
    include: {
      user: {
        select: {
          name: true,
          email: true,
          avatarUrl: true,
        },
      },
    },
  });
}
