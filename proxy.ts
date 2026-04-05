import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyAccessToken } from "./lib/security/auth/token";

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
  "/social" // Adicionado para a página de Ação Social do menu
];

const publicApiRoutes = [
  "/api/auth/login",
  "/api/auth/2fa",        // A validação do 2FA cria a sessão, logo precisa ser pública
  "/api/auth/register",   // Permite a criação de novas contas
  "/api/auth/refresh",    // O refresh precisa ser público para renovar sessões expiradas
  "/api/webhooks/payment" // Webhook tem validação HMAC própria na rota
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublicPage = publicPages.some(route => pathname === route || pathname.startsWith(`${route}/`));
  const isPublicApi = publicApiRoutes.some(route => pathname === route || pathname.startsWith(`${route}/`));

  // 1. Libera acesso para rotas públicas declaradas
  if (isPublicPage || isPublicApi) {
    return NextResponse.next();
  }

  // 2. Zero Trust: Exige autenticação para todo o resto
  const token = request.cookies.get("hezi_access_token")?.value;

  if (!token) {
    return handleUnauthorized(request);
  }

  try {
    // A biblioteca 'jose' é compatível com o Edge Runtime, 
    // permitindo verificar a assinatura do JWT de forma ultrarrápida.
    const payload = await verifyAccessToken(token);

    // Injetamos o ID e a Role nos cabeçalhos para facilitar a vida das rotas e server actions downstream
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-user-id", payload.userId);
    requestHeaders.set("x-user-role", payload.role);

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  } catch (error) {
    // Token inválido, adulterado ou expirado
    return handleUnauthorized(request);
  }
}

/**
 * Redireciona usuários sem acesso de acordo com o tipo de requisição.
 * - API: Recebe um JSON com erro 401.
 * - Páginas Web: Redirecionado para a tela de login.
 */
function handleUnauthorized(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Acesso negado. Autenticação obrigatória." },
      { status: 401 }
    );
  }
  
  // Atualizado para a nova rota de login sem o /auth
  const loginUrl = new URL("/login", request.url);
  
  // Opcional: Salvar a URL de origem para redirecionar o usuário após o login
  loginUrl.searchParams.set("callbackUrl", pathname);
  
  return NextResponse.redirect(loginUrl);
}

// O Matcher define em quais caminhos o Middleware vai rodar.
// Protegemos tudo, exceto arquivos estáticos, imagens e internos do Next.js.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|images|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};