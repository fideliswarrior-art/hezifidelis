import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Instancia o cliente do Redis usando as variáveis de ambiente padrão do Upstash
// (UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN)
const redis = Redis.fromEnv();

// Mapeamento exato da Seção 11 da Matriz de Defesa
export const rateLimitBuckets = {
  // 5 req/min por IP
  auth: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, "1 m"),
    prefix: "rl:auth",
  }),
  // 10 req/15min por e-mail (para prevenir brute force específico em contas)
  authEmail: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "15 m"),
    prefix: "rl:auth_email",
  }),
  // 100 req/min por IP do gateway
  webhook: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(100, "1 m"),
    prefix: "rl:webhook",
  }),
  // 60 req/min por usuário
  gameWrite: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(60, "1 m"),
    prefix: "rl:game_write",
  }),
  // 30 req/min por dispositivo/IP
  qrValidation: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, "1 m"),
    prefix: "rl:qr_validation",
  }),
  // 10 req/min por usuário
  checkout: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "1 m"),
    prefix: "rl:checkout",
  }),
  // 30 req/min por usuário
  adminWrite: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, "1 m"),
    prefix: "rl:admin_write",
  }),
  // 120 req/min por IP
  publicRead: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(120, "1 m"),
    prefix: "rl:public_read",
  }),
  // 200 req/min por usuário
  authRead: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(200, "1 m"),
    prefix: "rl:auth_read",
  }),
  // 10 req/min por usuário (restrito para evitar raspagem de logs)
  audit: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "1 m"),
    prefix: "rl:audit",
  }),
};

export type RateLimitBucket = keyof typeof rateLimitBuckets;