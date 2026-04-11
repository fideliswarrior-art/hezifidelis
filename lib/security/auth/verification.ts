import crypto from "crypto";
import { db } from "@/lib/db";

// Prazos rigorosos da sua Matriz de Defesa 
const RESET_PASSWORD_TTL = 15 * 60 * 1000; // 15 minutos
const EMAIL_VERIFICATION_TTL = 24 * 60 * 60 * 1000; // 24 horas

/**
 * Gera uma string criptograficamente segura de 43 caracteres
 * contendo letras, números e símbolos seguros para URL (Base64URL).
 */
function generateSecureToken(): string {
    // Gera 256 bits de entropia e resulta em uma string limpa de 43 caracteres (segura para URL).
    // É absurdamente seguro e extingue o risco de colisão.
    // Usamos 'base64url' no lugar de 'base64' comum para evitar símbolos como '+' e '/' 
    // que quebram parâmetros de URL. O 'base64url' usa '-' e '_'.
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Gera o token garantindo unicidade absoluta no banco de dados.
 * Funciona como a sua "Blacklist": se o token já existir, gera outro.
 */
async function createUniqueToken(email: string, type: "EMAIL_VERIFICATION" | "PASSWORD_RESET", ttl: number) {
  let isUnique = false;
  let token = "";

  // Loop de garantia de unicidade
  while (!isUnique) {
    token = generateSecureToken();
    
    // Checa na nossa "blacklist" natural (o banco de dados)
    const existing = await db.verificationToken.findUnique({
      where: { token }
    });

    if (!existing) {
      isUnique = true; // Achou um virgem, pode sair do loop!
    }
  }

  const expires = new Date(Date.now() + ttl);

  // Limpa qualquer token de verificação anterior desse e-mail para esse propósito
  await db.verificationToken.deleteMany({
    where: { email, type },
  });

  const newToken = await db.verificationToken.create({
    data: {
      email,
      token,
      type,
      expires,
    },
  });

  return newToken.token;
}

export async function generateEmailVerificationToken(email: string) {
  return createUniqueToken(email, "EMAIL_VERIFICATION", EMAIL_VERIFICATION_TTL);
}

export async function generatePasswordResetToken(email: string) {
  return createUniqueToken(email, "PASSWORD_RESET", RESET_PASSWORD_TTL);
}