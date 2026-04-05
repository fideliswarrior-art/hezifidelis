import { requireAuth } from "../guards/require-auth";
import { ForbiddenError } from "../guards/require-role";

/**
 * Garante que o usuário logado é o dono do recurso que está tentando acessar,
 * ou possui privilégios de ADMIN para fazer o bypass.
 */
export async function requireOwnershipOrAdmin(resourceUserId: string): Promise<void> {
  const session = await requireAuth();
  
  const isOwner = session.userId === resourceUserId;
  const isAdmin = session.role === "ADMIN" || session.role === "SUPER_ADMIN";

  if (!isOwner && !isAdmin) {
    throw new ForbiddenError("Você não tem permissão para acessar ou modificar os dados de outro usuário.");
  }
}