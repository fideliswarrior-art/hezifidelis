import { rateLimitBuckets, type RateLimitBucket } from "@/lib/security/ratelimit/buckets";

export class RateLimitError extends Error {
  constructor(message = "Muitas requisições. Tente novamente mais tarde.") {
    super(message);
    this.name = "RateLimitError";
  }
}

/**
 * Aplica o rate limit baseado no identificador e na política escolhida.
 * O identificador pode ser um IP (ex: publicRead), um ID de usuário (ex: authRead),
 * ou um e-mail (ex: authEmail).
 */
export async function applyRateLimit(identifier: string | null | undefined, bucket: RateLimitBucket) {
  // Previne que um identificador nulo burle o cache do Redis agrupando tudo numa chave genérica
  const safeIdentifier = identifier || "anonymous_fallback";
  
  const limiter = rateLimitBuckets[bucket];
  const result = await limiter.limit(safeIdentifier);

  if (!result.success) {
    // Fail secure: Se passou do limite, estouramos um erro.
    // No frontend ou no error boundary do Next, isso virará um status HTTP 429.
    const resetTime = new Date(result.reset).toLocaleTimeString();
    throw new RateLimitError(`Limite de requisições excedido. Tente novamente após as ${resetTime}.`);
  }

  // Retornamos os headers caso queira injetá-los nas respostas das rotas de API depois
  // (ex: X-RateLimit-Remaining)
  return result;
}