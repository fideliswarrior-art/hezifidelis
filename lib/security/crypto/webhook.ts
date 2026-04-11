// =============================================================================
// HEZI TECH — VERIFICAÇÃO HMAC DE WEBHOOKS DE PAGAMENTO
// =============================================================================
// Arquivo: lib/security/crypto/webhook.ts
// Camada de Defesa: C7 (Financeiro/Loja)
// Artigos LGPD: Art. 6º VII (Segurança), Art. 46 (Medidas técnicas)
//
// PROPÓSITO:
//   Verificar a autenticidade e integridade dos webhooks recebidos de
//   gateways de pagamento (Mercado Pago, Stripe, PagSeguro).
//   Sem esta verificação, um atacante poderia forjar webhooks e manipular
//   Payment.status, gerando ingressos sem pagamento real.
//
// REGRA DE NEGÓCIO CRÍTICA:
//   Payment.status SOMENTE pode ser atualizado via webhook com assinatura
//   HMAC válida. Nunca via API pública, mesmo por ADMIN.
//   (Ref: Seção 12.2 — Regras de negócio críticas)
//
// REFERÊNCIAS:
//   • Stripe Webhook Signatures: https://docs.stripe.com/webhooks/signatures
//   • Mercado Pago Webhooks: https://www.mercadopago.com.br/developers
//   • OWASP — Webhook Security
//   • Matriz de Defesa v1.0 — Camada C7
// =============================================================================

import { createHmac, timingSafeEqual } from "node:crypto";

// -----------------------------------------------------------------------------
// TIPOS
// -----------------------------------------------------------------------------

/**
 * Resultado da verificação de um webhook.
 * 
 * - `valid`: assinatura confere — payload é autêntico.
 * - `invalid_signature`: assinatura não confere — possível forjamento.
 * - `missing_signature`: header de assinatura ausente na requisição.
 * - `missing_secret`: variável PAYMENT_GATEWAY_WEBHOOK_SECRET não configurada.
 * - `expired`: timestamp do webhook excede a tolerância (replay attack).
 * - `malformed`: formato do header de assinatura não reconhecido.
 */
type WebhookVerificationStatus =
  | "valid"
  | "invalid_signature"
  | "missing_signature"
  | "missing_secret"
  | "expired"
  | "malformed";

interface WebhookVerificationResult {
  readonly status: WebhookVerificationStatus;
  readonly isValid: boolean;
}

// -----------------------------------------------------------------------------
// CONFIGURAÇÃO
// -----------------------------------------------------------------------------

/**
 * Tolerância máxima de timestamp para prevenir ataques de replay.
 * Webhooks com timestamp mais antigo que este valor são rejeitados.
 * 
 * 5 minutos (300 segundos) é o padrão da Stripe.
 * Ajuste conforme o gateway utilizado.
 */
const TIMESTAMP_TOLERANCE_SECONDS = 300;

// -----------------------------------------------------------------------------
// FUNÇÕES PÚBLICAS
// -----------------------------------------------------------------------------

/**
 * Verifica a assinatura HMAC-SHA256 de um webhook de pagamento.
 * 
 * Esta função é o ÚNICO ponto de entrada para validar webhooks.
 * Deve ser chamada ANTES de qualquer processamento do payload.
 * 
 * SEGURANÇA:
 *   - Usa `timingSafeEqual` para prevenir timing attacks.
 *   - Valida timestamp para prevenir replay attacks.
 *   - Retorna resultado tipado (nunca lança exceção com detalhes internos).
 * 
 * @param rawBody   - Body da requisição como string bruta (ANTES de JSON.parse).
 *                    CRÍTICO: usar request.text(), nunca request.json().
 *                    JSON.parse pode reordenar chaves, invalidando a assinatura.
 * 
 * @param signature - Valor do header de assinatura enviado pelo gateway.
 *                    Ex: Stripe usa "Stripe-Signature", Mercado Pago usa "x-signature".
 * 
 * @param secret    - Segredo compartilhado (PAYMENT_GATEWAY_WEBHOOK_SECRET).
 *                    Se undefined, retorna { status: "missing_secret" }.
 * 
 * @example
 * ```typescript
 * // Em app/api/webhooks/payment/route.ts:
 * import { verifyWebhookSignature } from "@/lib/security/crypto/webhook";
 * 
 * export async function POST(request: Request) {
 *   const rawBody = await request.text();
 *   const signature = request.headers.get("stripe-signature") ?? "";
 *   
 *   const result = verifyWebhookSignature(
 *     rawBody,
 *     signature,
 *     process.env["PAYMENT_GATEWAY_WEBHOOK_SECRET"]
 *   );
 * 
 *   if (!result.isValid) {
 *     return Response.json(
 *       { error: "Assinatura inválida." },
 *       { status: 401 }
 *     );
 *   }
 *   
 *   // Seguro para processar o payload
 *   const payload = JSON.parse(rawBody);
 *   // ...
 * }
 * ```
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string | undefined
): WebhookVerificationResult {

  // Guard: segredo não configurado
  if (!secret) {
    return { status: "missing_secret", isValid: false };
  }

  // Guard: assinatura ausente
  if (!signature) {
    return { status: "missing_signature", isValid: false };
  }

  // -------------------------------------------------------------------------
  // PARSE DO HEADER DE ASSINATURA
  // -------------------------------------------------------------------------
  // Suporta dois formatos comuns:
  //
  // Formato Stripe:  "t=1234567890,v1=abc123..."
  //   → Extrai timestamp (t) e assinatura (v1).
  //   → Signed payload = "{timestamp}.{rawBody}"
  //
  // Formato simples: "abc123..." (hash direto do body)
  //   → Sem timestamp (Mercado Pago, PagSeguro, gateways simples).
  //   → Signed payload = rawBody
  // -------------------------------------------------------------------------

  const isStripeFormat = signature.includes("t=") && signature.includes("v1=");

  if (isStripeFormat) {
    return verifyStripeFormat(rawBody, signature, secret);
  }

  return verifySimpleFormat(rawBody, signature, secret);
}

/**
 * Gera a assinatura HMAC-SHA256 de um payload.
 * 
 * Útil para:
 *   - Testes automatizados (gerar assinaturas válidas em fixtures).
 *   - Verificação manual durante debugging.
 * 
 * ATENÇÃO: Nunca expor esta função em rotas públicas.
 * 
 * @param payload - String a ser assinada.
 * @param secret  - Segredo HMAC.
 * @returns Hash HMAC-SHA256 em hexadecimal.
 */
export function generateWebhookSignature(
  payload: string,
  secret: string
): string {
  return createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");
}

/**
 * Gera o header de assinatura completo no formato Stripe.
 * 
 * Útil exclusivamente para testes automatizados.
 * 
 * @param payload   - Body do webhook.
 * @param secret    - Segredo HMAC.
 * @param timestamp - Timestamp em segundos (default: agora).
 * @returns Header no formato "t={timestamp},v1={signature}".
 */
export function generateStripeStyleHeader(
  payload: string,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000)
): string {
  const signedPayload = `${String(timestamp)}.${payload}`;
  const sig = generateWebhookSignature(signedPayload, secret);
  return `t=${String(timestamp)},v1=${sig}`;
}

// -----------------------------------------------------------------------------
// FUNÇÕES INTERNAS
// -----------------------------------------------------------------------------

/**
 * Verifica assinatura no formato Stripe: "t={timestamp},v1={signature}"
 * 
 * O signed payload é construído como: "{timestamp}.{rawBody}"
 * Isso previne ataques de replay pois o timestamp faz parte da assinatura.
 */
function verifyStripeFormat(
  rawBody: string,
  signature: string,
  secret: string
): WebhookVerificationResult {

  // Parse: extrair timestamp e assinatura
  const parts = new Map<string, string>();
  for (const element of signature.split(",")) {
    const [key, ...valueParts] = element.split("=");
    if (key && valueParts.length > 0) {
      parts.set(key.trim(), valueParts.join("=").trim());
    }
  }

  const timestampStr = parts.get("t");
  const sig = parts.get("v1");

  if (!timestampStr || !sig) {
    return { status: "malformed", isValid: false };
  }

  const timestamp = Number(timestampStr);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return { status: "malformed", isValid: false };
  }

  // Validação de replay: rejeitar webhooks fora da janela de tolerância
  const currentTime = Math.floor(Date.now() / 1000);
  const age = Math.abs(currentTime - timestamp);
  if (age > TIMESTAMP_TOLERANCE_SECONDS) {
    return { status: "expired", isValid: false };
  }

  // Recalcular assinatura com o mesmo formato: "{timestamp}.{body}"
  const signedPayload = `${timestampStr}.${rawBody}`;
  const expectedSig = generateWebhookSignature(signedPayload, secret);

  // Comparação timing-safe
  if (!safeCompare(sig, expectedSig)) {
    return { status: "invalid_signature", isValid: false };
  }

  return { status: "valid", isValid: true };
}

/**
 * Verifica assinatura no formato simples: hash direto do body.
 * 
 * Usado por gateways que enviam apenas o HMAC-SHA256 do body como header.
 * Não possui proteção contra replay (sem timestamp).
 * 
 * Para compensar a falta de timestamp:
 *   - O rate limit do bucket `webhook` (100 req/min) limita volume.
 *   - O idempotency check no service (Payment.externalId) previne duplicatas.
 */
function verifySimpleFormat(
  rawBody: string,
  signature: string,
  secret: string
): WebhookVerificationResult {

  const expectedSig = generateWebhookSignature(rawBody, secret);

  if (!safeCompare(signature, expectedSig)) {
    return { status: "invalid_signature", isValid: false };
  }

  return { status: "valid", isValid: true };
}

/**
 * Comparação de strings resistente a timing attacks.
 * 
 * Usa crypto.timingSafeEqual que garante tempo constante de execução
 * independente de quantos bytes coincidem. Isso impede um atacante de
 * descobrir a assinatura correta byte a byte medindo tempos de resposta.
 * 
 * Se os buffers têm tamanhos diferentes, retorna false imediatamente.
 * Isso é seguro porque o tamanho de um HMAC-SHA256 é público (64 hex chars).
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  return timingSafeEqual(bufA, bufB);
}