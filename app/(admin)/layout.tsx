import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole, ForbiddenError } from "@/lib/security/guards/require-role";
import { UnauthorizedError } from "@/lib/security/guards/require-auth";

/**
 * ============================================================================
 * LAYOUT: Painel Administrativo (Onda 2 - E2.4)
 * ============================================================================
 * * OBJETIVO:
 * Atuar como o "Cinto de Segurança" principal da área restrita. Este layout 
 * intercepta todas as requisições para rotas dentro de /(admin) e valida o 
 * papel (Role) do usuário antes mesmo da renderização da página.
 * * * PROTEÇÕES APLICADAS (Camada C3 - RBAC):
 * 1. requireRole: Valida se o usuário tem a role ADMIN no banco de dados.
 * 2. Fallback de Erro: Se não estiver logado ou não for admin, redireciona 
 * ou lança erro de acesso negado.
 * 3. Isolamento Visual: Define a navegação lateral (Sidebar) e cabeçalho 
 * específicos para a gestão da plataforma.
 * ============================================================================
 */

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    // 1. Barreira de Segurança: Só Admins passam por aqui.
    // O requireRole utiliza a sessão JWT e consulta o Prisma para garantir 
    // que o papel não foi revogado.
    await requireRole(Role.ADMIN);

  } catch (error) {
    // 2. Tratamento de Acesso Negado
    if (error instanceof UnauthorizedError) {
      return redirect("/login?callbackUrl=/auditoria");
    }
    if (error instanceof ForbiddenError) {
      // Usuário logado mas sem permissão
      return redirect("/dashboard?error=access_denied");
    }
    // Fallback genérico de segurança
    return redirect("/");
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* BARRA LATERAL (Sidebar) */}
      <aside className="w-64 border-r bg-white p-6 hidden md:block">
        <div className="mb-8">
          <h2 className="text-xl font-bold text-slate-900">Hezi Admin</h2>
          <p className="text-xs text-slate-500 uppercase tracking-wider">Painel de Controle</p>
        </div>
        
        <nav className="space-y-1">
          <a href="/auditoria" className="flex items-center px-3 py-2 text-sm font-medium rounded-md bg-slate-100 text-slate-900">
             Audit Log
          </a>
          {/* Outros links do admin virão aqui nas próximas ondas */}
        </nav>
      </aside>

      {/* CONTEÚDO PRINCIPAL */}
      <main className="flex-1">
        <header className="h-16 border-b bg-white flex items-center px-8 justify-between">
          <h1 className="text-sm font-medium text-slate-600 uppercase tracking-widest">
            Segurança & Observabilidade
          </h1>
          {/* Componente de Perfil do Usuário Logado poderia ir aqui */}
        </header>
        
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  );
}