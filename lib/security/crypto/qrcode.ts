// =============================================================================
// HEZI TECH — GERAÇÃO E VALIDAÇÃO SEGURA DE QR CODES PARA INGRESSOS
// =============================================================================
// Arquivo: lib/security/crypto/qrcode.ts
// Camada de Defesa: C8 (Ingressos/QR)
// Artigos LGPD: Art. 6º VII (Segurança), Art. 46, Art. 6º X (Responsabilização)
//
// PROPÓSITO:
//   Gerar identificadores únicos e criptograficamente seguros para ingressos
//   (Ticket.qrCode), renderizar QR Codes visuais e produzir hashes seguros
//   para registro em AuditLog (nunca logando o valor bruto do QR).
//
// REGRAS DE NEGÓCIO CRÍTICAS:
//   • Ticket.qrCode é gerado UMA ÚNICA VEZ, nunca alterado.
//   • Ticket.isUsed = true é TERMINAL — reversão somente SUPER_ADMIN + AuditLog.
//   • No AuditLog, armazenar APENAS o hash do qrCode, nunca o UUID bruto.
//   • Ticket gerado SOMENTE após Payment.status = APPROVED (via webhook HMAC).
//   • holderName e holderDocument visíveis APENAS no endpoint de validação (ADMIN+).
//   (Ref: Seção 12.1 e 12.5 — Regras de banco e privacidade)
//
// FLUXO DE USO:
//   1. Payment.status → APPROVED (via webhook.ts verificado)
//   2. ticket.service.ts chama generateTicketCode() → salva em Ticket.qrCode
//   3. ticket.service.ts chama hashForAudit(qrCode) → salva no AuditLog
//   4. ticket.service.ts chama generateTicketQrImage(qrCode) → retorna Data URL
//   5. Na entrada do evento, validateQr() recebe scan → busca no banco
//   6. SELECT FOR UPDATE garante atomicidade (sem ticket duplicado)
//
// REFERÊNCIAS:
//   • RFC 4122 — UUID v4
//   • OWASP — Session Management Cheat Sheet (entropia de tokens)
//   • Matriz de Defesa v1.0 — Camada C8
// =============================================================================

import { randomUUID, createHash, randomBytes } from "node:crypto";
import QRCode from "qrcode";

// -----------------------------------------------------------------------------
// TIPOS
// -----------------------------------------------------------------------------

/**
 * Resultado da geração de um código de ticket.
 *
 * - `code`: UUID v4 único que será armazenado em Ticket.qrCode.
 * - `auditHash`: SHA-256 hex do code, para registro seguro no AuditLog.
 */
interface TicketCodeResult {
  readonly code: string;
  readonly auditHash: string;
}

/**
 * Resultado da validação de formato de um QR code.
 */
interface QrFormatValidation {
  readonly isValid: boolean;
  readonly reason?: string;
}

/**
 * Opções para geração da imagem QR.
 */
interface QrImageOptions {
  /** Largura/altura em pixels. Default: 300 */
  readonly width?: number;
  /** Margem em módulos QR. Default: 2 */
  readonly margin?: number;
  /** Nível de correção de erro. Default: "H" (30% de redundância) */
  readonly errorCorrectionLevel?: "L" | "M" | "Q" | "H";
  /** Cor escura (foreground). Default: "#000000" */
  readonly darkColor?: string;
  /** Cor clara (background). Default: "#FFFFFF" */
  readonly lightColor?: string;
}

// -----------------------------------------------------------------------------
// CONFIGURAÇÃO
// -----------------------------------------------------------------------------

/** Prefixo para identificação visual e validação rápida de formato. */
const TICKET_CODE_PREFIX = "HEZI";

/** Separador entre prefixo e UUID. */
const TICKET_CODE_SEPARATOR = "-";

/**
 * Regex para validação de formato do QR code.
 * Formato: HEZI-{uuid-v4}
 * Exemplo: HEZI-550e8400-e29b-41d4-a716-446655440000
 */
const TICKET_CODE_PATTERN =
  /^HEZI-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// -----------------------------------------------------------------------------
// FUNÇÕES PÚBLICAS — GERAÇÃO
// -----------------------------------------------------------------------------

/**
 * Gera um código único e criptograficamente seguro para um ingresso.
 *
 * O código segue o formato: HEZI-{UUID-v4}
 *
 * O prefixo "HEZI" serve para:
 *   - Identificação visual rápida (debugging, suporte ao cliente).
 *   - Validação de formato antes de consultar o banco (fail-fast).
 *   - Diferenciação de outros QR codes que o usuário possa ter no celular.
 *
 * ENTROPIA:
 *   UUID v4 = 122 bits de entropia (crypto.randomUUID usa CSPRNG).
 *   Probabilidade de colisão em 1 bilhão de tickets: ~2.7 × 10⁻²⁰.
 *   Adicional: unicidade garantida pelo constraint @unique no schema.
 *
 * RETORNO:
 *   - `code`: o valor completo a ser salvo em Ticket.qrCode.
 *   - `auditHash`: SHA-256 hex do code, para o AuditLog.
 *     NUNCA logar o `code` diretamente — isso permitiria reconstruir
 *     o QR a partir dos logs.
 *
 * @example
 * ```typescript
 * const { code, auditHash } = generateTicketCode();
 *
 * // Salvar no banco
 * await db.ticket.create({
 *   data: { qrCode: code, batchId, userId, price }
 * });
 *
 * // Registrar no AuditLog (nunca o code bruto)
 * await createAuditLog(userId, "TICKET_GENERATE", "Ticket", ticketId, null,
 *   { qrCodeHash: auditHash, batchId }, ip);
 * ```
 */
export function generateTicketCode(): TicketCodeResult {
  const uuid = randomUUID();
  const code = `${TICKET_CODE_PREFIX}${TICKET_CODE_SEPARATOR}${uuid}`;
  const auditHash = hashForAudit(code);

  return { code, auditHash };
}

/**
 * Gera um hash SHA-256 de um valor para registro seguro no AuditLog.
 *
 * Usado para registrar REFERÊNCIAS a dados sensíveis nos logs
 * sem expor o valor real. O hash permite correlação posterior
 * (se necessário, um SUPER_ADMIN pode hashear o qrCode de um ticket
 * específico e buscar no AuditLog) sem expor todos os códigos.
 *
 * @param value - Valor a ser hasheado (ex: Ticket.qrCode).
 * @returns Hash SHA-256 em hexadecimal (64 caracteres).
 *
 * @example
 * ```typescript
 * const hash = hashForAudit(ticket.qrCode);
 * // hash = "a3f2b8c1d4e5..."  (64 hex chars)
 * // Salvar no AuditLog.metadata.qrCodeHash
 * ```
 */
export function hashForAudit(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// -----------------------------------------------------------------------------
// FUNÇÕES PÚBLICAS — RENDERIZAÇÃO DE QR CODE
// -----------------------------------------------------------------------------

/**
 * Gera uma imagem QR Code como Data URL (base64 PNG).
 *
 * O resultado pode ser usado diretamente em uma tag <img>:
 *   <img src={dataUrl} alt="QR Code do ingresso" />
 *
 * Ou enviado por e-mail como imagem inline após a compra.
 *
 * CONFIGURAÇÃO DE CORREÇÃO DE ERRO:
 *   Nível "H" (High) é usado por padrão, oferecendo 30% de redundância.
 *   Isso garante leitura mesmo com QR parcialmente danificado ou
 *   com logo sobreposto (caso futuro de branding no QR).
 *
 * @param ticketCode - O Ticket.qrCode completo (ex: "HEZI-550e8400-...").
 * @param options    - Opções de renderização (dimensão, cores, margem).
 * @returns Data URL no formato "data:image/png;base64,..."
 *
 * @throws Error se a geração do QR falhar (ex: dados muito longos).
 *
 * @example
 * ```typescript
 * const dataUrl = await generateTicketQrImage(ticket.qrCode);
 * // Retornar ao frontend para exibição
 * return Response.json({ qrImage: dataUrl });
 * ```
 */
export async function generateTicketQrImage(
  ticketCode: string,
  options: QrImageOptions = {},
): Promise<string> {
  const {
    width = 300,
    margin = 2,
    errorCorrectionLevel = "H",
    darkColor = "#000000",
    lightColor = "#FFFFFF",
  } = options;

  const dataUrl: string = await QRCode.toDataURL(ticketCode, {
    width,
    margin,
    errorCorrectionLevel,
    color: {
      dark: darkColor,
      light: lightColor,
    },
  });

  return dataUrl;
}

/**
 * Gera o QR Code como Buffer PNG (para envio por e-mail ou armazenamento).
 *
 * Diferente do `generateTicketQrImage` que retorna Data URL (para frontend),
 * este retorna o buffer bruto do PNG para uso server-side.
 *
 * @param ticketCode - O Ticket.qrCode completo.
 * @param options    - Opções de renderização.
 * @returns Buffer com os bytes do PNG.
 *
 * @example
 * ```typescript
 * const pngBuffer = await generateTicketQrBuffer(ticket.qrCode);
 * // Anexar ao e-mail de confirmação via Nodemailer
 * attachments: [{ filename: "ingresso.png", content: pngBuffer }]
 * ```
 */
export async function generateTicketQrBuffer(
  ticketCode: string,
  options: QrImageOptions = {},
): Promise<Buffer> {
  const {
    width = 300,
    margin = 2,
    errorCorrectionLevel = "H",
    darkColor = "#000000",
    lightColor = "#FFFFFF",
  } = options;

  const buffer: Buffer = await QRCode.toBuffer(ticketCode, {
    width,
    margin,
    errorCorrectionLevel,
    color: {
      dark: darkColor,
      light: lightColor,
    },
  });

  return buffer;
}

// -----------------------------------------------------------------------------
// FUNÇÕES PÚBLICAS — VALIDAÇÃO
// -----------------------------------------------------------------------------

/**
 * Valida o formato de um QR code ANTES de consultar o banco.
 *
 * PROPÓSITO (Fail-Fast):
 *   Rejeitar QR codes com formato inválido sem gastar uma query no banco.
 *   Isso protege contra:
 *   - Scans acidentais de outros QR codes (URLs, contatos, etc.).
 *   - Tentativas de injeção via scanner (SQL injection via QR).
 *   - Brute force: o formato HEZI-{uuid} reduz o espaço de busca válido.
 *
 * Esta função NÃO verifica se o ticket existe ou se já foi usado.
 * Isso é responsabilidade do ticket.service.ts com SELECT FOR UPDATE.
 *
 * @param code - String lida pelo scanner QR.
 * @returns Objeto com `isValid` e `reason` (se inválido).
 *
 * @example
 * ```typescript
 * // No endpoint POST /api/tickets/validate
 * const format = validateQrFormat(scannedCode);
 * if (!format.isValid) {
 *   return Response.json({ error: format.reason }, { status: 400 });
 * }
 * // Prosseguir com busca no banco via SELECT FOR UPDATE
 * ```
 */
export function validateQrFormat(code: string): QrFormatValidation {
  if (!code || typeof code !== "string") {
    return { isValid: false, reason: "Código QR ausente ou inválido." };
  }

  const trimmed = code.trim();

  if (trimmed.length === 0) {
    return { isValid: false, reason: "Código QR vazio." };
  }

  if (!trimmed.startsWith(TICKET_CODE_PREFIX + TICKET_CODE_SEPARATOR)) {
    return { isValid: false, reason: "Formato de código não reconhecido." };
  }

  if (!TICKET_CODE_PATTERN.test(trimmed)) {
    return { isValid: false, reason: "Código QR com formato inválido." };
  }

  return { isValid: true };
}

/**
 * Extrai o UUID do código de ticket (remove o prefixo HEZI-).
 *
 * Útil para queries onde o banco armazena apenas o UUID,
 * ou para logs estruturados onde o prefixo é redundante.
 *
 * @param code - Código completo (ex: "HEZI-550e8400-...").
 * @returns UUID sem prefixo, ou null se o formato for inválido.
 */
export function extractUuidFromCode(code: string): string | null {
  const validation = validateQrFormat(code);
  if (!validation.isValid) {
    return null;
  }

  return code.slice(TICKET_CODE_PREFIX.length + TICKET_CODE_SEPARATOR.length);
}

// -----------------------------------------------------------------------------
// FUNÇÕES PÚBLICAS — UTILITÁRIOS DE SEGURANÇA
// -----------------------------------------------------------------------------

/**
 * Gera um token opaco de alta entropia para uso geral.
 *
 * Diferente de generateTicketCode (que usa UUID v4 com prefixo),
 * este gera bytes aleatórios puros — útil para tokens internos
 * onde o formato humano não importa.
 *
 * @param bytes - Número de bytes de entropia. Default: 32 (256 bits).
 * @returns String hexadecimal (64 caracteres para 32 bytes).
 */
export function generateOpaqueToken(bytes: number = 32): string {
  return randomBytes(bytes).toString("hex");
}

// -----------------------------------------------------------------------------
// FUNÇÕES PÚBLICAS — QR CODE DE JOGADOR (Check-in E3.5)
// -----------------------------------------------------------------------------

/** Prefixo para QR de check-in de jogador. */
const PLAYER_CODE_PREFIX = "HEZI-PLAYER";

/**
 * Regex para validação de formato do QR de jogador.
 * Formato: HEZI-PLAYER-{uuid-v4}
 */
const PLAYER_CODE_PATTERN =
  /^HEZI-PLAYER-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Gera código QR permanente para check-in de jogador.
 *
 * Formato: HEZI-PLAYER-{UUID-v4}
 * Diferente do ticket (que é descartável), este QR é permanente
 * e vinculado ao Player.checkInQrCode.
 *
 * REGRAS:
 *   ★ Gerado server-side, nunca do client.
 *   ★ Apenas ADMIN pode gerar/regenerar.
 *   ★ No AuditLog, armazenar APENAS o hash (hashForAudit).
 */
export function generatePlayerCode(): TicketCodeResult {
  const uuid = randomUUID();
  const code = `${PLAYER_CODE_PREFIX}-${uuid}`;
  const auditHash = hashForAudit(code);

  return { code, auditHash };
}

/**
 * Valida formato do QR de jogador (fail-fast antes do banco).
 */
export function validatePlayerQrFormat(code: string): QrFormatValidation {
  if (!code || typeof code !== "string") {
    return { isValid: false, reason: "Código QR ausente ou inválido." };
  }

  const trimmed = code.trim();

  if (!PLAYER_CODE_PATTERN.test(trimmed)) {
    return {
      isValid: false,
      reason: "Código QR de jogador com formato inválido.",
    };
  }

  return { isValid: true };
}
