import { headers } from "next/headers";

/**
 * Extrai o IP real do cliente a partir dos cabeçalhos da requisição.
 * Vital para a Camada C11 (Rate Limit) e C12 (Auditoria).
 */
export async function getClientIp(): Promise<string> {
  try {
    const headersList = await headers();
    
    // 'x-forwarded-for' é o padrão da indústria e da Vercel
    const forwardedFor = headersList.get("x-forwarded-for");
    if (forwardedFor) {
      // O [0]?.trim() garante que se o índice 0 não existir (undefined), 
      // ele não quebra a aplicação e pula direto para o próximo passo.
      const firstIp = forwardedFor.split(",")[0]?.trim();
      if (firstIp) return firstIp;
    }
    
    return headersList.get("x-real-ip") || "127.0.0.1";
  } catch (error) {
    return "127.0.0.1"; // Fallback seguro
  }
}