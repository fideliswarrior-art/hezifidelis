import * as OTPAuth from "otpauth";
import QRCode from "qrcode";

const APP_ISSUER = "Hezi Fidelis"; // O nome que vai aparecer no app do usuário

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

  return {
    secret: secret.base32, // Esse valor vai para o banco de dados (twoFactorSecret)
    qrCodeDataUrl,         // Esse valor vai para o frontend exibir a imagem
    uri,                   // Opcional: uri pura caso o usuário queira copiar o texto
  };
}

/**
 * Valida o código de 6 dígitos inserido pelo usuário contra o segredo salvo no banco.
 */
export function verifyTwoFactorToken(secretBase32: string, token: string): boolean {
  try {
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
    return false; // Falha na validação (ex: base32 malformado)
  }
}