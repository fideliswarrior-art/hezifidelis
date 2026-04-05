import { SignJWT, jwtVerify } from "jose";

// Em produção, isso DEVE vir do seu .env
// O TextEncoder é necessário porque a biblioteca 'jose' exige a chave como Uint8Array
const getJwtSecret = () => new TextEncoder().encode(process.env.JWT_SECRET || "chave-secreta-dev-muito-segura-123");
const getRefreshSecret = () => new TextEncoder().encode(process.env.JWT_REFRESH_SECRET || "chave-secreta-refresh-dev-456");

export type TokenPayload = {
  userId: string;
  role: string;
  tokenVersion: number;
};

/**
 * Gera um par de tokens (Access e Refresh) para o usuário.
 * Segue a regra C2: TTL 15min (access) / 7d (refresh)
 */
export async function generateTokens(payload: TokenPayload) {
  // O jti (JWT ID) é gerado para permitir a invalidação individual (blacklist)
  const jtiAccess = crypto.randomUUID();
  const jtiRefresh = crypto.randomUUID();

  const accessToken = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(jtiAccess)
    .setIssuedAt()
    .setExpirationTime("15m") //
    .sign(getJwtSecret());

  const refreshToken = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(jtiRefresh)
    .setIssuedAt()
    .setExpirationTime("7d") //
    .sign(getRefreshSecret());

  return { accessToken, refreshToken, jtiAccess, jtiRefresh };
}

/**
 * Verifica a assinatura e validade temporal do Access Token.
 */
export async function verifyAccessToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return payload as TokenPayload & { jti: string; exp: number };
  } catch (error) {
    throw new Error("Access token inválido ou expirado");
  }
}

/**
 * Verifica a assinatura e validade temporal do Refresh Token.
 */
export async function verifyRefreshToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getRefreshSecret());
    return payload as TokenPayload & { jti: string; exp: number };
  } catch (error) {
    throw new Error("Refresh token inválido ou expirado");
  }
}