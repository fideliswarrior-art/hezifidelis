import { headers } from "next/headers";

export class CsrfError extends Error {
  constructor(message = "Falha na validação CSRF (Origem inválida).") {
    super(message);
    this.name = "CsrfError";
  }
}

/**
 * Valida se a requisição originou-se do próprio domínio da aplicação.
 * Protege contra requisições forjadas de sites maliciosos.
 */
export async function verifyCsrfOrigin(): Promise<boolean> {
  const headersList = await headers();
  const origin = headersList.get("origin");
  const host = headersList.get("host");

  if (!origin || !host) return false;

  try {
    const originUrl = new URL(origin);
    if (originUrl.host !== host) {
      throw new CsrfError();
    }
    return true;
  } catch (error) {
    throw new CsrfError();
  }
}