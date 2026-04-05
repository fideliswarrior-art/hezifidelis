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
 * Garante que a requisição possui um JWT válido, que o usuário
 * continua ativo e que a sessão não foi globalmente revogada.
 */
export async function requireAuth(): Promise<TokenPayload> {
  const session = await getSession();

  if (!session) {
    throw new UnauthorizedError();
  }

  // Consulta otimizada: busca os campos críticos, AGORA INCLUINDO o tokenVersion
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { isActive: true, role: true, tokenVersion: true }, 
  });

  // Se o usuário foi deletado ou inativado, mata a sessão atual
  if (!user || !user.isActive) {
    await clearSession();
    throw new UnauthorizedError("Conta desativada ou não encontrada.");
  }

  // A Mágica da Camada C2: Invalidação Global
  // Se o tokenVersion do JWT for diferente do banco (ex: senha alterada), revoga o acesso.
  if (user.tokenVersion !== session.tokenVersion) {
    await clearSession();
    throw new UnauthorizedError("Sessão revogada em outro dispositivo. Faça login novamente.");
  }

  // Retorna os dados frescos do banco, ignorando o cargo antigo do payload
  return {
    ...session,
    role: user.role,
  };
}