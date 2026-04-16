import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyAccessToken } from "./lib/security/auth/token";
import { generateCspNonce } from "./lib/security/csp/nonce";
import { buildCspHeader } from "./lib/security/csp/csp.config";

/**
 * ============================================================================
 * MIDDLEWARE: Zero Trust Proxy + CSP Dynamic Nonce (Onda 2)
 * ============================================================================
 * * Este middleware atua como a primeira camada de defesa (C10 - Conteúdo/Mídia)
 * da Hezi Tech.
 * * FUNÇÕES PRINCIPAIS:
 * 1. Geração de Nonce: Cria um identificador único para a CSP em cada request.
 * 2. Segurança de Conteúdo (CSP): Injeta o header CSP para mitigar XSS.
 * 3. Autenticação Zero Trust: Garante acesso apenas a rotas autorizadas.
 */

// Mapeamento de exceções explícitas (Rotas Públicas)
const publicPages = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",    
  "/auth/verify-email", 
  "/jogadores",
  "/times",
  "/partidas",
  "/social" 
];

const publicApiRoutes = [
  "/api/auth/login",
  "/api/auth/2fa",        
  "/api/auth/register",   
  "/api/auth/refresh",    
  "/api/webhooks/payment" 
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // --- 1. CONFIGURAÇÃO DE SEGURANÇA DE CONTEÚDO (Onda 2) ---
  // Geramos o nonce e construímos a política dinâmica.
  const nonce = generateCspNonce();
  const env = process.env.NODE_ENV === "production" ? "production" : "development";
  const cspHeaderValue = buildCspHeader(nonce, env);

  // Injetamos o nonce nos headers da requisição.
  // Isso permite que o layout.tsx e outros Server Components acessem via headers().
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const isPublicPage = publicPages.some(route => pathname === route || pathname.startsWith(`${route}/`));
  const isPublicApi = publicApiRoutes.some(route => pathname === route || pathname.startsWith(`${route}/`));

  // --- 2. GESTÃO DE ACESSO (Zero Trust) ---
  
  let response: NextResponse;

  // A. Libera acesso para rotas públicas
  if (isPublicPage || isPublicApi) {
    response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  } else {
    // B. Exige autenticação para rotas privadas
    const token = request.cookies.get("hezi_access_token")?.value;

    if (!token) {
      return applyCspHeader(handleUnauthorized(request), cspHeaderValue);
    }

    try {
      const payload = await verifyAccessToken(token);

      // Injetamos metadados do usuário autenticado para as rotas downstream.
      requestHeaders.set("x-user-id", payload.userId);
      requestHeaders.set("x-user-role", payload.role);

      response = NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });
    } catch (error) {
      return applyCspHeader(handleUnauthorized(request), cspHeaderValue);
    }
  }

  // --- 3. APLICAÇÃO DA CSP (Onda 2) ---
  // O header CSP deve estar presente em TODAS as respostas para garantir proteção.
  return applyCspHeader(response, cspHeaderValue);
}

/**
 * Utilitário para injetar o header de Content-Security-Policy na resposta.
 */
function applyCspHeader(response: NextResponse, cspValue: string) {
  response.headers.set("Content-Security-Policy", cspValue);
  return response;
}

/**
 * Redireciona usuários sem acesso de acordo com o tipo de requisição.
 */
function handleUnauthorized(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Acesso negado. Autenticação obrigatória." },
      { status: 401 }
    );
  }
  
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("callbackUrl", pathname);
  
  return NextResponse.redirect(loginUrl);
}

// O Matcher define em quais caminhos o Middleware vai rodar.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|images|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};