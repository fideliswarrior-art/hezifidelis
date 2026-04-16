import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { encrypt, decrypt } from "@/lib/security/crypto/encryption";

const APP_ISSUER = "Hezi Famly"; // O nome que vai aparecer no app do usuário

/**
 * ============================================================================
 * MÓDULO: Autenticação de Dois Fatores (Onda 2 - E2.5)
 * ============================================================================
 * Atualizado com Criptografia AES-256-GCM. O segredo (base32) nunca mais
 * transita ou repousa em texto plano no banco de dados.
 */

/**
 * Gera um novo segredo base32 e a URL do QR Code.
 * Usado quando o usuário está ATIVANDO o 2FA pela primeira vez.
 */
export async function generateTwoFactorSecret(userEmail: string) {
  // Cria um segredo criptograficamente seguro de 20 bytes
  const secret = new OTPAuth.Secret({ size: 20 });

  // Configura a instância do TOTP
  const totp = new OTPAuth.TOTP({
    issuer: APP_ISSUER,
    label: userEmail,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: secret,
  });

  const uri = totp.toString();

  // Gera a imagem do QR Code em formato Data URL (base64) para renderizar direto na tag <img> do frontend
  const qrCodeDataUrl = await QRCode.toDataURL(uri);

  // CRIPTOGRAFIA (E2.5): Ciframos o base32 puro antes de devolver
  const encryptedSecret = encrypt(secret.base32);

  return {
    // Mantemos o nome 'secret' na chave do objeto para NÃO quebrar a sua API atual.
    // O seu Service vai salvar isso direto no banco de dados com segurança máxima.
    secret: encryptedSecret,
    qrCodeDataUrl,
    uri,
  };
}

/**
 * Valida o código de 6 dígitos inserido pelo usuário contra o segredo salvo no banco.
 * Suporta tanto segredos antigos (texto puro) quanto novos (AES-256).
 */
export function verifyTwoFactorToken(dbSecret: string, token: string): boolean {
  try {
    let secretBase32 = dbSecret;

    // LÓGICA DE TRANSIÇÃO SEGURA (Graceful Fallback):
    // Se a string contiver ':', significa que já é o formato novo cifrado (keyId:iv:tag:cipher).
    // Caso contrário, é um usuário antigo que ainda não passou pelo script de backfill.
    if (dbSecret.includes(":")) {
      secretBase32 = decrypt(dbSecret);
    }

    const totp = new OTPAuth.TOTP({
      issuer: APP_ISSUER,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });

    // O window de 1 aceita o token do ciclo atual, 1 passado e 1 futuro.
    // Isso é essencial para mitigar pequenos atrasos no relógio do celular do usuário.
    const delta = totp.validate({ token, window: 1 });

    // Se delta for null, o token é inválido.
    return delta !== null;
  } catch (error) {
    return false; // Falha na validação (ex: token inválido ou falha de descriptografia GCM)
  }
}
