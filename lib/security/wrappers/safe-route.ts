import { NextResponse, type NextRequest } from "next/server";
import { verifyCsrfOrigin, CsrfError } from "../utils/csrf";
import { UnauthorizedError } from "../guards/require-auth";
import { ForbiddenError } from "../guards/require-role";
import { applyRateLimit, RateLimitError } from "../ratelimit/limiter";
import { getClientIp } from "../utils/get-ip";
import type { RateLimitBucket } from "../ratelimit/buckets";
import { ValidationError } from "../utils/validate";

type RouteConfig = {
  rateLimitBucket?: RateLimitBucket;
  checkCsrf?: boolean; // Default true para POST/PUT/PATCH/DELETE
};

/**
 * Envelopa um Route Handler (API) para tratar erros de segurança
 * e retornar status HTTP padronizados.
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

    } catch (error: any) {
      // Tratamento centralizado de HTTP Status
      if (error instanceof CsrfError || error instanceof UnauthorizedError) {
        return NextResponse.json({ error: error.message }, { status: 401 });
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

      console.error("[SAFE_ROUTE_ERROR]", error);
      return NextResponse.json({ error: "Erro interno no servidor." }, { status: 500 });
    }
  };
}