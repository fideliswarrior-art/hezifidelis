import { z } from "zod";
import { type Role } from "@prisma/client";
import { verifyCsrfOrigin, CsrfError } from "@/lib/security/utils/csrf";
import { validatePayload, ValidationError } from "@/lib/security/utils/validate";
import { requireAuth, UnauthorizedError } from "@/lib/security/guards/require-auth";
import { requireRole, ForbiddenError } from "@/lib/security/guards/require-role";
import { applyRateLimit, RateLimitError } from "@/lib/security/ratelimit/limiter";
import { getClientIp } from "@/lib/security/utils/get-ip";
import type { RateLimitBucket } from "@/lib/security/ratelimit/buckets";
import type { TokenPayload } from "@/lib/security/auth/token";

type ActionConfig<T> = {
  schema?: z.Schema<T>;
  requireAuth?: boolean;
  requireRole?: Role;
  rateLimitBucket?: RateLimitBucket;
};

type ActionResponse<R> = 
  | { success: true; data: R }
  | { success: false; error: string; issues?: z.ZodIssue[] };

/**
 * Envelopa um Server Action com todas as proteções da Matriz de Defesa.
 * Executa CSRF, Rate Limit, Auth, RBAC e Anti-Mass-Assignment automaticamente.
 */
export async function safeAction<Input, Output>(
  config: ActionConfig<Input>,
  handler: (parsedInput: Input, session: TokenPayload | null) => Promise<Output>,
  rawInput?: unknown
): Promise<ActionResponse<Output>> {
  try {
    // 1. Defesa CSRF (Obrigatória em mutations)
    await verifyCsrfOrigin();

    // 2. Camada C11 - Rate Limiting
    if (config.rateLimitBucket) {
      const ip = await getClientIp();
      await applyRateLimit(ip, config.rateLimitBucket);
    }

    // 3. Camada C3 - RBAC e Autenticação
    let session: TokenPayload | null = null;
    if (config.requireRole) {
      session = await requireRole(config.requireRole);
    } else if (config.requireAuth) {
      session = await requireAuth();
    }

    // 4. Camada C1 - Anti Mass-Assignment (Zod Validation)
    let parsedInput = rawInput as Input;
    if (config.schema && rawInput !== undefined) {
      parsedInput = validatePayload(config.schema, rawInput);
    }

    // 5. Executa o código real da Action
    const result = await handler(parsedInput, session);
    return { success: true, data: result };

  } catch (error: any) {
    // Mapeamento elegante de erros para o frontend
    if (error instanceof CsrfError || error instanceof UnauthorizedError) {
      return { success: false, error: error.message };
    }
    if (error instanceof ForbiddenError || error instanceof RateLimitError) {
      return { success: false, error: error.message };
    }
    if (error instanceof ValidationError) {
      return { success: false, error: "Dados inválidos.", issues: error.issues };
    }
    
    console.error("[SAFE_ACTION_ERROR]", error);
    return { success: false, error: "Erro interno no servidor." };
  }
}