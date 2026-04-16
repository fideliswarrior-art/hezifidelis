import { randomBytes } from "crypto";

/**
 * ============================================================================
 * MÓDULO: Gerenciamento de Chaves Criptográficas (Onda 2 - E2.5)
 * ============================================================================
 * * OBJETIVO:
 * Centralizar a leitura, validação e cache em memória das chaves AES-256.
 * * DECISÕES DE SEGURANÇA (Camada C13):
 * 1. Fail-Secure: Se a chave ausente em PROD, a aplicação lança erro e não sobe.
 * 2. Fallback de Dev: Em desenvolvimento, gera uma chave efêmera para não travar
 * o trabalho, mas emite um alerta claro no console.
 * 3. Validação Estrita: Exige exatamente 32 bytes (256 bits) após o decode.
 * ============================================================================
 */

export class EncryptionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EncryptionError";
  }
}

export interface EncryptionKey {
  id: string;
  buffer: Buffer;
}

// Cache em memória para evitar decodificação base64 a cada operação
let activeKeyCache: EncryptionKey | null = null;

/**
 * Recupera a chave de criptografia principal (ativa) para novos registros.
 */
export function getActiveKey(): EncryptionKey {
  if (activeKeyCache) return activeKeyCache;

  const keyBase64 = process.env.DATA_ENCRYPTION_KEY;
  const keyId = process.env.DATA_ENCRYPTION_KEY_ID || "k1";

  if (!keyBase64) {
    if (process.env.NODE_ENV === "production") {
      throw new EncryptionError(
        "Chave de criptografia ausente no ambiente de produção.",
        "KEY_UNAVAILABLE",
      );
    }
    // Fallback para desenvolvimento local
    console.warn(
      "⚠️ [SECURITY WARNING] DATA_ENCRYPTION_KEY ausente. Usando chave efêmera de dev.",
    );
    activeKeyCache = { id: "dev-key", buffer: randomBytes(32) };
    return activeKeyCache;
  }

  const buffer = Buffer.from(keyBase64, "base64");

  if (buffer.length !== 32) {
    throw new EncryptionError(
      "A chave de criptografia deve ter exatamente 32 bytes.",
      "INVALID_KEY_SIZE",
    );
  }

  activeKeyCache = { id: keyId, buffer };
  return activeKeyCache;
}

/**
 * Recupera uma chave específica pelo seu ID (Essencial para rotação de chaves).
 */
export function getKeyById(keyId: string): EncryptionKey {
  const active = getActiveKey();

  if (active.id === keyId) {
    return active;
  }

  // TODO: Se implementarmos múltiplas chaves antigas no .env (ex: OLD_KEYS), a busca seria aqui.
  throw new EncryptionError(
    `Chave não encontrada para o ID: ${keyId}`,
    "KEY_NOT_FOUND",
    { keyId },
  );
}
