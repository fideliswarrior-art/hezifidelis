"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConsentPurpose } from "@prisma/client";

/**
 * ============================================================================
 * PÁGINA: Gestão de Privacidade e Consentimento (Onda 2 - E2.6)
 * ============================================================================
 * * OBJETIVO:
 * Interface para o utilizador gerir as suas preferências de privacidade.
 * Usada tanto no primeiro acesso (onboarding) quanto nas configurações do perfil.
 * * REGRAS DE NEGÓCIO:
 * 1. ESSENTIAL não pode ser desmarcado.
 * 2. Ao carregar, busca o estado atual do banco (/api/me/consent).
 * 3. Ao salvar, faz disparos paralelos (Promise.all) de POST/DELETE conforme
 * o estado dos toggles.
 * ============================================================================
 */

// Mapeamento das finalidades para textos humanos e descritivos
const PURPOSE_DETAILS: Record<string, { title: string; desc: string; locked: boolean }> = {
  [ConsentPurpose.ESSENTIAL]: {
    title: "Operação Básica (Obrigatório)",
    desc: "Necessário para o funcionamento da plataforma, segurança da sua conta e execução do torneio.",
    locked: true,
  },
  [ConsentPurpose.PROFILE_PUBLIC]: {
    title: "Perfil Público e Estatísticas",
    desc: "Permite que outros utilizadores vejam o seu perfil, histórico de times e estatísticas de jogo.",
    locked: false,
  },
  [ConsentPurpose.PHOTO_EVENTS]: {
    title: "Uso de Imagem em Eventos",
    desc: "Autoriza o uso da sua imagem nas galerias de fotos e vídeos oficiais das partidas e campanhas.",
    locked: false,
  },
  [ConsentPurpose.MARKETING_EMAIL]: {
    title: "Comunicações e Promoções",
    desc: "Receba novidades, alertas de novos torneios e ofertas exclusivas da loja.",
    locked: false,
  },
  [ConsentPurpose.ANALYTICS]: {
    title: "Melhoria Contínua (Analytics)",
    desc: "Ajuda-nos a melhorar o sistema através da recolha de dados anónimos de navegação.",
    locked: false,
  },
  [ConsentPurpose.THIRD_PARTY_SHARE]: {
    title: "Partilha com Patrocinadores",
    desc: "Partilha de dados com parceiros da liga para receber benefícios e descontos exclusivos.",
    locked: false,
  },
};

// A versão atual da política. Em produção, isso poderia vir de uma variável de ambiente.
const CURRENT_POLICY_VERSION = "1.0.0";

export default function ConsentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const [consents, setConsents] = useState<Record<string, boolean>>({
    [ConsentPurpose.ESSENTIAL]: true, // Sempre true
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Carrega as preferências salvas no banco
  useEffect(() => {
    async function fetchConsents() {
      try {
        const res = await fetch("/api/me/consent");
        const json = await res.json();

        if (json.success && Array.isArray(json.data)) {
          const loadedConsents: Record<string, boolean> = { [ConsentPurpose.ESSENTIAL]: true };
          
          json.data.forEach((c: any) => {
            loadedConsents[c.purpose] = c.granted;
          });

          setConsents(prev => ({ ...prev, ...loadedConsents }));
        }
      } catch (err) {
        console.error("Erro ao carregar consentimentos", err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchConsents();
  }, []);

  const handleToggle = (purpose: string) => {
    if (PURPOSE_DETAILS[purpose]?.locked) return;
    
    setConsents(prev => ({
      ...prev,
      [purpose]: !prev[purpose]
    }));
  };

  const handleSave = () => {
    startTransition(async () => {
      setError(null);
      setSuccessMsg(null);

      try {
        // Monta um array de requisições baseadas no estado atual dos toggles
        const promises = Object.keys(PURPOSE_DETAILS).map(async (purpose) => {
          if (purpose === ConsentPurpose.ESSENTIAL) return; // Não alteramos o essencial por esta via

          const isGranted = consents[purpose] === true;

          if (isGranted) {
            return fetch("/api/me/consent", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ purpose, policyVersion: CURRENT_POLICY_VERSION })
            });
          } else {
            return fetch("/api/me/consent", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ purpose })
            });
          }
        });

        await Promise.all(promises);

        setSuccessMsg("As suas preferências de privacidade foram atualizadas.");
        
        // Se veio de um redirecionamento (ex: primeiro login), envia de volta
        setTimeout(() => {
          router.push(callbackUrl);
        }, 1500);

      } catch (err) {
        setError("Ocorreu um erro ao salvar as suas preferências. Tente novamente.");
      }
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        
        <div className="px-6 py-8 border-b border-slate-200 bg-slate-50">
          <h1 className="text-2xl font-bold text-slate-900">Privacidade e Dados Pessoais</h1>
          <p className="mt-2 text-sm text-slate-600">
            A Hezi Tech leva a sua privacidade a sério. Controle exatamente como utilizamos 
            os seus dados na nossa plataforma, em conformidade com a LGPD.
          </p>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="p-4 bg-red-50 text-red-700 rounded-md text-sm font-medium">
              {error}
            </div>
          )}
          
          {successMsg && (
            <div className="p-4 bg-green-50 text-green-700 rounded-md text-sm font-medium">
              {successMsg}
            </div>
          )}

          <div className="space-y-4">
            {Object.entries(PURPOSE_DETAILS).map(([purpose, details]) => {
              const isChecked = consents[purpose] === true;
              
              return (
                <div 
                  key={purpose} 
                  className={`flex items-start p-4 rounded-lg border ${
                    details.locked ? 'bg-slate-50 border-slate-200' : 'bg-white border-slate-200 hover:border-blue-300 transition-colors'
                  }`}
                >
                  <div className="flex-1 pr-4">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {details.title}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {details.desc}
                    </p>
                  </div>
                  
                  <div className="ml-4 flex items-center h-full pt-1">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isChecked}
                      disabled={details.locked || isPending}
                      onClick={() => handleToggle(purpose)}
                      className={`
                        relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent 
                        transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2
                        ${isChecked ? 'bg-blue-600' : 'bg-slate-200'}
                        ${details.locked ? 'opacity-50 cursor-not-allowed' : ''}
                      `}
                    >
                      <span
                        aria-hidden="true"
                        className={`
                          pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 
                          transition duration-200 ease-in-out
                          ${isChecked ? 'translate-x-5' : 'translate-x-0'}
                        `}
                      />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-6 border-t border-slate-200 flex items-center justify-between">
            <a 
              href="/privacy" 
              target="_blank"
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              Ler a Política de Privacidade Completa
            </a>
            
            <button
              onClick={handleSave}
              disabled={isPending}
              className="inline-flex justify-center rounded-md border border-transparent bg-blue-600 py-2 px-6 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {isPending ? "A guardar..." : "Salvar Preferências"}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}