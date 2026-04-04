import { Role } from "@prisma/client";
import { requireAuth } from "./require-auth";
import { roleAtLeast } from "../policy/roles";

export class ForbiddenError extends Error {
  constructor(message = "Acesso negado: privilégios insuficientes.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Garante que o usuário autenticado possui o papel mínimo exigido
 * de acordo com a hierarquia global do sistema.
 */
export async function requireRole(minimumRole: Role) {
  // Primeiro, obriga a estar autenticado
  const session = await requireAuth();
  const userRole = session.role as Role;

  // Depois, verifica se o cargo tem o peso necessário
  if (!roleAtLeast(userRole, minimumRole)) {
    throw new ForbiddenError(`Esta ação requer privilégios de nível ${minimumRole}.`);
  }

  return session;
}