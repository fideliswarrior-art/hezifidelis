import { cookies } from "next/headers";
import { generateTokens, verifyAccessToken, verifyRefreshToken, type TokenPayload } from "@/lib/security/auth/token";

const ACCESS_COOKIE_NAME = "hezi_access_token";
const REFRESH_COOKIE_NAME = "hezi_refresh_token";

/**
 * Cria a sessão do usuário, gerando os tokens e injetando-os nos cookies
 * de forma segura (HttpOnly, Secure, SameSite).
 */
export async function createSession(payload: TokenPayload) {
  const { accessToken, refreshToken, jtiAccess, jtiRefresh } = await generateTokens(payload);
  const cookieStore = await cookies();

  // Cookie de acesso: expira em 15 minutos
  cookieStore.set(ACCESS_COOKIE_NAME, accessToken, {
    httpOnly: true, //
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60, // 15 minutos em segundos
  });

  // Cookie de refresh: expira em 7 dias
  cookieStore.set(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true, //
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60, // 7 dias em segundos
  });

  return { jtiAccess, jtiRefresh };
}

/**
 * Recupera e valida a sessão atual a partir dos cookies da requisição.
 * Ideal para ser usado nos Guards e Middlewares.
 */
export async function getSession() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE_NAME)?.value;

  if (!accessToken) {
    return null; // Usuário não autenticado
  }

  try {
    const payload = await verifyAccessToken(accessToken);
    return payload;
  } catch (error) {
    // Se o token de acesso for inválido ou estiver expirado, 
    // a renovação via Refresh Token deve ser tentada na rota de /auth/refresh
    return null; 
  }
}

/**
 * Destrói a sessão, limpando os cookies.
 * O jti (obtido pelo payload antes de deletar) deve ser adicionado à blacklist na rota de logout.
 */
export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(ACCESS_COOKIE_NAME);
  cookieStore.delete(REFRESH_COOKIE_NAME);
}

/**
 * Utilitário exposto para a rota de refresh, permitindo a leitura do refresh token bruto.
 */
export async function getRefreshTokenFromCookie() {
  const cookieStore = await cookies();
  return cookieStore.get(REFRESH_COOKIE_NAME)?.value;
}