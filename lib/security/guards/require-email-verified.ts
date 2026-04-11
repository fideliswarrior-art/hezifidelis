// =============================================================================
// HEZI TECH — GUARD: EMAIL VERIFICADO OBRIGATÓRIO
// =============================================================================
// Arquivo: lib/security/guards/require-email-verified.ts
// Camada de Defesa: C1 (Identidade), C7 (Financeiro), C13 (LGPD)
// Artigos LGPD: Art. 6º VII (Segurança), Art. 8º (Consentimento verificável)
//
// PROPÓSITO:
//   Garantir que ações sensíveis só sejam executadas por usuários com
//   e-mail confirmado. Complementa o bloqueio de login (que já impede
//   acesso sem e-mail verificado), adicionando uma segunda verificação
//   no ponto exato da operação.
//
//   Isso é necessário porque:
//     • Um ADMIN pode ter reativado uma conta sem re-verificar o e-mail.
//     • Uma migração de dados pode ter importado usuários sem verificação.
//     • Defense in Depth: mesmo que o bloqueio de login falhe, a operação
//       sensível ainda está protegida.
//
// AÇÕES PROTEGIDAS:
//   • Checkout (criar pedido)
//   • Doação monetária
//   • Inscrição em eventos/torneios
//   • Alteração de dados pessoais sensíveis
//   • Qualquer operação que gere obrigação financeira
//
// USO:
//   Sempre APÓS requireAuth — depende do userId da sessão.
//
// REFERÊNCIAS:
//   • Matriz de Defesa v1.0 — Camadas C1, C7
//   • Seção 12.3 — Regras de autorização
// =============================================================================

import { db } from "@/lib/db";

// -----------------------------------------------------------------------------
// TIPOS
// -----------------------------------------------------------------------------

/**
 * Sessão mínima necessária — compatível com o retorno de requireAuth.
 */
interface SessionContext {
  readonly userId: string;
}

/**
 * Dados do usuário retornados após verificação.
 * Inclui campos frequentemente necessários pelo caller.
 */
interface VerifiedUserContext {
  readonly userId: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string;
}

// -----------------------------------------------------------------------------
// CLASSES DE ERRO
// -----------------------------------------------------------------------------

/**
 * Erro lançado quando o e-mail do usuário não está verificado.
 *
 * Mapeado para HTTP 403 pelo safe-route.ts.
 * 
 * Inclui código estruturado para que o frontend possa exibir uma
 * tela específica com botão de reenvio de e-mail de verificação.
 */
export class EmailNotVerifiedError extends Error {
  public readonly statusCode = 403;
  public readonly code = "EMAIL_NOT_VERIFIED";

  constructor() {
    super(
      "Ação bloqueada. Você precisa confirmar seu e-mail antes de " +
      "realizar esta operação. Verifique sua caixa de entrada ou " +
      "solicite um novo e-mail de verificação."
    );
    this.name = "EmailNotVerifiedError";
  }
}

/**
 * Erro lançado quando o usuário não é encontrado no banco.
 * Cenário raro: sessão válida mas usuário deletado entre o requireAuth
 * e este guard.
 */
class UserNotFoundError extends Error {
  public readonly statusCode = 401;

  constructor() {
    super("Sessão inválida. Faça login novamente.");
    this.name = "UserNotFoundError";
  }
}

// -----------------------------------------------------------------------------
// FUNÇÃO PRINCIPAL
// -----------------------------------------------------------------------------

/**
 * Verifica se o e-mail do usuário autenticado está confirmado.
 * 
 * CADEIA DE VERIFICAÇÃO:
 *   1. Busca o usuário no banco por ID (sessão).
 *   2. Se não existe → lança UserNotFoundError (401).
 *   3. Se emailVerified = false → lança EmailNotVerifiedError (403).
 *   4. Retorna dados do usuário para uso downstream.
 * 
 * NOTA: Consulta o banco em tempo real (não confia no token JWT)
 * seguindo o padrão do require-auth.ts que sempre busca dados frescos.
 * 
 * @param session - Sessão autenticada (de requireAuth).
 * @returns VerifiedUserContext com dados confirmados.
 * @throws UserNotFoundError se o usuário não existe.
 * @throws EmailNotVerifiedError se o e-mail não está verificado.
 * 
 * @example
 * ```typescript
 * // Em order.service.ts — checkout():
 * const session = await requireAuth();
 * await requireRole("USER");
 * const user = await requireEmailVerified(session);
 * // Seguro para processar pedido — e-mail confirmado
 * ```
 * 
 * @example
 * ```typescript
 * // Em EventRegistration — inscrição em torneio:
 * const session = await requireAuth();
 * await requireEmailVerified(session);
 * // Seguro para inscrever — identidade verificada
 * ```
 */
export async function requireEmailVerified(
  session: SessionContext
): Promise<VerifiedUserContext> {

  // -------------------------------------------------------------------------
  // 1. BUSCA NO BANCO
  // -------------------------------------------------------------------------
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      name: true,
      emailVerified: true,
    },
  });

  // -------------------------------------------------------------------------
  // 2. EXISTÊNCIA
  // -------------------------------------------------------------------------
  if (!user) {
    throw new UserNotFoundError();
  }

  // -------------------------------------------------------------------------
  // 3. VERIFICAÇÃO DE E-MAIL
  // -------------------------------------------------------------------------
  if (!user.emailVerified) {
    throw new EmailNotVerifiedError();
  }

  // -------------------------------------------------------------------------
  // 4. RETORNO
  // -------------------------------------------------------------------------
  return {
    userId: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    name: user.name,
  };
}

/**
 * Verifica e-mail sem lançar exceção — retorna boolean.
 * 
 * Útil para renderização condicional no frontend (Server Components).
 * 
 * @example
 * ```typescript
 * const verified = await isEmailVerified(session);
 * // Se false, exibir banner "Confirme seu e-mail para continuar"
 * ```
 */
export async function isEmailVerified(
  session: SessionContext
): Promise<boolean> {
  try {
    await requireEmailVerified(session);
    return true;
  } catch {
    return false;
  }
}