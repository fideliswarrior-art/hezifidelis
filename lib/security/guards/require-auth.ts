import { getSession, clearSession } from "../auth/session";
import type { TokenPayload } from "../auth/token";
import { db } from "../../db";

export class UnauthorizedError extends Error {
  constructor(message = "Não autorizado. Faça login para continuar.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Garante que a requisição possui um JWT válido e que o usuário
 * continua ativo no banco de dados.
 */
export async function requireAuth(): Promise<TokenPayload> {
  const session = await getSession();

  if (!session) {
    throw new UnauthorizedError();
  }

  // Consulta otimizada: busca apenas os campos críticos
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { isActive: true, role: true }, // Removido tokenVersion, pois não existe no schema
  });

  // Se o usuário foi deletado ou inativado, mata a sessão atual
  if (!user || !user.isActive) {
    await clearSession();
    throw new UnauthorizedError("Conta desativada ou não encontrada.");
  }

  // Retorna os dados frescos do banco, ignorando o cargo antigo do payload
  return {
    ...session,
    role: user.role,
  };
}