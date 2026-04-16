import { ConsentPurpose } from "@prisma/client";
import { requireAuth } from "@/lib/security/guards/require-auth";
import { hasConsent } from "@/lib/services/privacy/consent.service";

/**
 * ============================================================================
 * HEZI TECH — GUARD: LGPD CONSENT REQUIREMENT
 * ============================================================================
 * Arquivo: lib/security/guards/require-consent.ts
 * Camada de Defesa: C13 (Privacidade/LGPD)
 * Artigos LGPD: Art. 7º (Base Legal), Art. 8º (Consentimento Livre)
 *
 * PROPÓSITO:
 * Garantir que uma ação sensível (ex: exportar perfil público, analytics)
 * só seja executada se o usuário tiver concedido o consentimento explícito
 * para a finalidade (purpose) correspondente.
 *
 * USO:
 * Sempre APÓS ou JUNTO com requireAuth, pois depende do userId da sessão.
 *
 * REFERÊNCIAS:
 * • Matriz de Defesa v1.0 — Camada C13
 * ============================================================================
 */

export class ConsentRequiredError extends Error {
  public readonly statusCode = 403;

  constructor(
    public readonly purpose: ConsentPurpose,
    message = "Ação bloqueada: É necessário fornecer consentimento explícito para esta funcionalidade.",
  ) {
    super(message);
    this.name = "ConsentRequiredError";
  }
}

/**
 * Verifica se o usuário autenticado concedeu consentimento para uma finalidade específica.
 * Se não, lança um ConsentRequiredError (403), que é capturado pelo safe-route.ts.
 * * @param purpose A finalidade exigida (ex: ConsentPurpose.MARKETING_EMAIL)
 * @returns O payload da sessão atual (facilitando o encadeamento de guards)
 */
export async function requireConsent(purpose: ConsentPurpose) {
  // 1. Garante que o usuário está logado
  const session = await requireAuth();

  // 2. Verifica no banco se o consentimento está ativo
  const isGranted = await hasConsent(session.userId, purpose);

  if (!isGranted) {
    throw new ConsentRequiredError(
      purpose,
      `Para prosseguir, você precisa aceitar os termos de: ${purpose}. Acesse suas configurações de privacidade.`,
    );
  }

  return session;
}
