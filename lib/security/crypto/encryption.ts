import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { getActiveKey, getKeyById, EncryptionError } from "./key-management";

/**
 * ============================================================================
 * MÓDULO: Motor de Criptografia AES-256-GCM (Onda 2 - E2.5)
 * ============================================================================
 * * OBJETIVO:
 * Prover criptografia autenticada para dados sensíveis em repouso (Data at Rest).
 * Algoritmo escolhido: aes-256-gcm (Garante confidencialidade E integridade).
 * * * FORMATO DO CIPHERTEXT:
 * "keyId:ivBase64:authTagBase64:cipherBase64"
 * ============================================================================
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 12 bytes é o padrão de segurança recomendado para GCM

/**
 * Criptografa uma string plana.
 * @param plaintext O texto a ser protegido.
 * @returns O ciphertext formatado com IV, AuthTag e KeyID.
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) {
    throw new Error("Plaintext não pode ser vazio.");
  }

  // 1. Busca a chave ativa e gera um IV (Vetor de Inicialização) único
  const key = getActiveKey();
  const iv = randomBytes(IV_LENGTH);

  // 2. Inicializa o cipher
  const cipher = createCipheriv(ALGORITHM, key.buffer, iv);

  // 3. Criptografa o dado
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");

  // 4. Extrai a Tag de Autenticação (Garante que o dado não foi adulterado no banco)
  const authTag = cipher.getAuthTag();

  // 5. Retorna o formato padronizado da plataforma
  return `${key.id}:${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
}

/**
 * Descriptografa um ciphertext gerado pela função `encrypt`.
 * @param ciphertext O texto cifrado no formato padrão.
 * @returns O texto plano original.
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) return "";

  // 1. Faz o split das partes
  const parts = ciphertext.split(":");
  if (parts.length !== 4) {
    throw new EncryptionError(
      "Formato de ciphertext inválido.",
      "MALFORMED_CIPHERTEXT",
    );
  }

  // Usamos cast de tupla para garantir ao TypeScript estrito que as 4 variáveis são strings
  const [keyId, ivBase64, authTagBase64, encryptedBase64] = parts as [
    string,
    string,
    string,
    string,
  ];

  // 2. Busca a chave correta pelo ID (permite que dados antigos continuem legíveis)
  const key = getKeyById(keyId);

  try {
    const iv = Buffer.from(ivBase64, "base64");
    const authTag = Buffer.from(authTagBase64, "base64");

    // 3. Inicializa o decipher
    const decipher = createDecipheriv(ALGORITHM, key.buffer, iv);

    // OBRIGATÓRIO NO GCM: Seta a tag de autenticação antes do final()
    decipher.setAuthTag(authTag);

    // 4. Descriptografa. Tipagem explícita (string) para evitar erros com o Node crypto.
    let decrypted: string = decipher.update(encryptedBase64, "base64", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (error) {
    // Falhas aqui indicam violação de integridade (dados adulterados) ou chave errada.
    throw new EncryptionError(
      "Falha na autenticação ou descriptografia dos dados.",
      "AUTHENTICATION_FAILED",
    );
  }
}

/**
 * Verifica heurísticamente se um valor já está criptografado no formato da plataforma.
 * Útil para rotinas de backfill e migração incremental.
 * @param value O valor a ser verificado.
 * @returns true se o valor possuir as 4 partes do ciphertext, false caso contrário.
 */
export function isEncrypted(value: string): boolean {
  if (!value) return false;
  // O nosso formato padrão sempre tem 4 partes separadas por ":"
  const parts = value.split(":");
  return parts.length === 4;
}

/**
 * Helper para criptografar campos que podem ser nulos.
 */
export async function encryptField<T extends string>(
  plaintext: T | null | undefined,
): Promise<string | null> {
  if (!plaintext) return null;
  return encrypt(plaintext);
}

/**
 * Helper para descriptografar campos que podem ser nulos.
 */
export async function decryptField(
  ciphertext: string | null | undefined,
): Promise<string | null> {
  if (!ciphertext) return null;
  if (!isEncrypted(ciphertext)) return ciphertext; // Graceful degradation para dados legados
  return decrypt(ciphertext);
}
