// Variáveis globais para controlar a "Fila de Refresh"
// Impede que 5 requisições simultâneas disparem 5 renovações ao mesmo tempo
let isRefreshing = false;
let failedQueue: Array<{ resolve: (value?: Response) => void; reject: (reason?: any) => void }> = [];

const processQueue = (error: Error | null) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve();
  });
  failedQueue = [];
};

/**
 * Wrapper de Fetch blindado.
 * Injeta headers padrão, intercepta erros 401 para renovação silenciosa (Sliding Session)
 * e redireciona para o login em caso de revogação da sessão.
 */
export async function secureFetch(url: string, options: RequestInit = {}): Promise<Response> {
  // Configuração padrão de segurança
  const config: RequestInit = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    // No Next.js (App Router) requisições locais para a mesma origem já enviam cookies.
    // Mas garantir 'same-origin' é uma boa prática para proteção CSRF.
    credentials: "same-origin", 
  };

  let response = await fetch(url, config);

  // A Mágica da Sessão Deslizante
  if (response.status === 401 && url !== "/api/auth/refresh" && url !== "/api/auth/login" && url !== "/api/auth/2fa") {
    
    // Se já tiver uma renovação em andamento, coloca essa requisição na fila de espera
    if (isRefreshing) {
      return new Promise(function (resolve, reject) {
        failedQueue.push({ resolve, reject });
      })
        .then(() => fetch(url, config)) // Quando a fila for processada, tenta de novo
        .catch((err) => Promise.reject(err));
    }

    isRefreshing = true;

    try {
      // Bate silenciosamente na nossa rota blindada de refresh
      const refreshRes = await fetch("/api/auth/refresh", { 
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      if (refreshRes.ok) {
        // Sucesso! A API injetou cookies fresquinhos.
        processQueue(null);
        // Refaz a requisição original que havia falhado
        response = await fetch(url, config);
      } else {
        // Falha! O refresh token expirou (passou de 7 dias) ou caiu na Blacklist
        throw new Error("Sessão expirada definitivamente");
      }
    } catch (err) {
      processQueue(err as Error);
      // Aqui nós aplicamos o Zero Trust no front: Derruba o usuário para a tela de login
      if (typeof window !== "undefined") {
        window.location.href = "/login?expired=true";
      }
    } finally {
      isRefreshing = false;
    }
  }

  // Opcional: Centralizar tratamento de Rate Limit
  if (response.status === 429) {
    console.warn(`[Segurança] Rate limit atingido na rota: ${url}`);
    // Você poderia até disparar um Toast genérico aqui avisando o usuário para ir mais devagar
  }

  return response;
}