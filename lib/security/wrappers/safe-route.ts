import { NextResponse, type NextRequest } from "next/server";
import { verifyCsrfOrigin, CsrfError } from "@/lib/security/utils/csrf";
import { UnauthorizedError } from "@/lib/security/guards/require-auth";
import { ForbiddenError } from "@/lib/security/guards/require-role";
import { applyRateLimit, RateLimitError } from "@/lib/security/ratelimit/limiter";
import { getClientIp } from "@/lib/security/utils/get-ip";
import type { RateLimitBucket } from "@/lib/security/ratelimit/buckets";
import { ValidationError } from "@/lib/security/utils/validate";

type RouteConfig = {
  rateLimitBucket?: RateLimitBucket;
  checkCsrf?: boolean; // Default true para POST/PUT/PATCH/DELETE
};

/**
 * Envelopa um Route Handler (API) para tratar erros de segurança
 * e retornar status HTTP padronizados.
 * 
 * MAPEAMENTO DE ERROS:
 *   1. Classes conhecidas (instanceof) → status HTTP fixo.
 *   2. Qualquer erro com propriedade `statusCode` numérica (4xx/5xx)
 *      → usa esse código + error.message. Isso permite que guards futuros
 *      (ex: MatchStatusError, StatusTransitionError, CheckoutError)
 *      funcionem automaticamente sem alterar este arquivo.
 *   3. Erro desconhecido sem statusCode → 500 genérico (nunca vaza stack).
 */
export function safeRoute(
  handler: (req: NextRequest, ctx: any) => Promise<NextResponse>,
  config: RouteConfig = {}
) {
  return async (req: NextRequest, ctx: any) => {
    try {
      // 1. Defesa CSRF automática para métodos que alteram estado
      const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
      if (isMutation && config.checkCsrf !== false) {
        await verifyCsrfOrigin();
      }

      // 2. Camada C11 - Rate Limiting
      if (config.rateLimitBucket) {
        const ip = await getClientIp();
        await applyRateLimit(ip, config.rateLimitBucket);
      }

      // Se passou pelas travas iniciais, executa o handler
      return await handler(req, ctx);

    } catch (error: unknown) {
      // -----------------------------------------------------------------
      // TRATAMENTO CENTRALIZADO DE HTTP STATUS
      // -----------------------------------------------------------------

      // Classes conhecidas da Fase 1 / 1.5 (instanceof direto)
      if (error instanceof CsrfError || error instanceof UnauthorizedError) {
        return NextResponse.json({ error: (error as Error).message }, { status: 401 });
      }
      if (error instanceof ForbiddenError) {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      if (error instanceof RateLimitError) {
        return NextResponse.json({ error: error.message }, { status: 429 });
      }
      if (error instanceof ValidationError) {
        return NextResponse.json(
          { error: "Dados da requisição inválidos", issues: error.issues }, 
          { status: 400 }
        );
      }

      // -----------------------------------------------------------------
      // FALLBACK GENÉRICO POR statusCode (Onda 1+)
      // -----------------------------------------------------------------
      // Qualquer erro que possua `statusCode` numérico entre 400-599
      // é tratado como erro de domínio conhecido. Isso cobre:
      //   • MatchOfficialError     (403)
      //   • MatchNotFoundError     (404)
      //   • MatchStatusError       (422)
      //   • StatusTransitionError  (422)
      //   • EmailNotVerifiedError  (403)
      //   • CheckoutError          (422)
      //   • InsufficientStockError (422)
      //   • ProductNotAvailableError (422)
      //   • CouponError            (422)
      //   • EmptyCartError         (422)
      //   • ...e qualquer guard futuro que siga a convenção.
      // -----------------------------------------------------------------
      if (
        error instanceof Error &&
        "statusCode" in error &&
        typeof (error as any).statusCode === "number"
      ) {
        const statusCode = (error as any).statusCode as number;

        // Só aceita códigos HTTP válidos de erro (4xx e 5xx)
        if (statusCode >= 400 && statusCode < 600) {
          // Para erros do tipo CheckoutError, incluir o `code` se disponível
          const body: Record<string, unknown> = { error: error.message };

          if ("code" in error && typeof (error as any).code === "string") {
            body.code = (error as any).code;
          }

          return NextResponse.json(body, { status: statusCode });
        }
      }

      // -----------------------------------------------------------------
      // ERRO DESCONHECIDO → 500 (nunca vaza stack trace)
      // -----------------------------------------------------------------
      console.error("[SAFE_ROUTE_ERROR]", error);
      return NextResponse.json({ error: "Erro interno no servidor." }, { status: 500 });
    }
  };
}