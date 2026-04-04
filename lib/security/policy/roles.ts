import { Role } from "@prisma/client";

// Mapeando a hierarquia da Seção 2.1 para pesos numéricos
export const ROLE_HIERARCHY: Record<Role, number> = {
  USER: 10,
  EDITOR: 20,
  MODERATOR: 30,
  SCOREKEEPER: 40,
  REFEREE: 40, // Mesário e Árbitro têm o mesmo peso base
  ADMIN: 50,
  SUPER_ADMIN: 100,
};

/**
 * Retorna true se o papel do usuário for maior ou igual ao exigido.
 */
export function roleAtLeast(userRole: Role, requiredRole: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}