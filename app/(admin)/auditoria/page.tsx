"use client";

import { useState, useEffect, useTransition } from "react";
import { getAuditLogsAction } from "./_actions";
import type { AuditLogFilterParams } from "@/lib/services/audit/audit-query.service";

/**
 * ============================================================================
 * PÁGINA: Dashboard de Auditoria (Onda 2 - E2.4)
 * ============================================================================
 * * OBJETIVO:
 * Interface de Observabilidade (Camada C12) para monitoramento de logs.
 * Permite aos administradores investigarem o histórico imutável do sistema.
 * * * ARQUITETURA VISUAL E REATIVIDADE:
 * 1. Client Component: Gerencia estados locais de paginação e filtros.
 * 2. useTransition: Mantém a interface responsiva (não bloqueante) enquanto
 * os logs são buscados via Server Action.
 * 3. Paginação por Cursor: O botão "Carregar Mais" injeta o nextCursor 
 * na próxima requisição, garantindo performance em tabelas gigantes.
 * ============================================================================
 */

// Tipagem auxiliar para os logs retornados pela Action
type AuditLogItem = {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  ip: string | null;
  createdAt: Date;
  user: {
    name: string;
    email: string;
    role: string;
  };
};

export default function AuditoriaPage() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Estados dos filtros
  const [filters, setFilters] = useState({
    action: "",
    entity: "",
    ip: "",
  });

  // Função central para buscar os dados usando a Server Action
  const fetchLogs = (cursor?: string, reset = false) => {
    startTransition(async () => {
      setError(null);
      
      // Monta o payload respeitando o Zod Schema do _actions.ts
      const payload: AuditLogFilterParams = {
        take: 20,
        cursor,
        ...(filters.action && { action: filters.action }),
        ...(filters.entity && { entity: filters.entity }),
        ...(filters.ip && { ip: filters.ip }),
      };

      const result = await getAuditLogsAction(payload);

      if (result.success) {
        setLogs(prev => reset ? result.data.items : [...prev, ...result.data.items]);
        setNextCursor(result.data.nextCursor);
      } else {
        setError(result.error || "Falha ao carregar os logs de auditoria.");
      }
    });
  };

  // Carrega os dados iniciais e reage a mudanças nos filtros
  useEffect(() => {
    // Usamos um pequeno debounce/timeout para não floodar o servidor enquanto o admin digita
    const timeoutId = setTimeout(() => {
      fetchLogs(undefined, true);
    }, 500);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Registro de Auditoria</h2>
        <p className="text-sm text-slate-500">
          Trilha imutável de ações sensíveis e eventos de segurança da plataforma.
        </p>
      </div>

      {/* BARRA DE FILTROS */}
      <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 rounded-lg border shadow-sm">
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-700 mb-1">Ação (Ex: MEDIA_UPLOAD)</label>
          <input
            type="text"
            className="w-full text-sm border-slate-200 rounded-md focus:ring-blue-500 focus:border-blue-500"
            placeholder="Filtrar por ação..."
            value={filters.action}
            onChange={(e) => setFilters(prev => ({ ...prev, action: e.target.value }))}
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-700 mb-1">Entidade</label>
          <input
            type="text"
            className="w-full text-sm border-slate-200 rounded-md focus:ring-blue-500 focus:border-blue-500"
            placeholder="Filtrar por entidade..."
            value={filters.entity}
            onChange={(e) => setFilters(prev => ({ ...prev, entity: e.target.value }))}
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-700 mb-1">Endereço IP</label>
          <input
            type="text"
            className="w-full text-sm border-slate-200 rounded-md focus:ring-blue-500 focus:border-blue-500"
            placeholder="Buscar IP..."
            value={filters.ip}
            onChange={(e) => setFilters(prev => ({ ...prev, ip: e.target.value }))}
          />
        </div>
      </div>

      {/* MENSAGEM DE ERRO (Se houver) */}
      {error && (
        <div className="p-4 bg-red-50 text-red-600 rounded-md text-sm">
          {error}
        </div>
      )}

      {/* TABELA DE DADOS */}
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Data / Hora</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Ator</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Ação</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Entidade</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Origem (IP)</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {logs.length === 0 && !isPending ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-sm text-slate-500">
                    Nenhum registro encontrado para os filtros atuais.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                      {new Date(log.createdAt).toLocaleString('pt-BR')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-slate-900">{log.user.name}</div>
                      <div className="text-xs text-slate-500">{log.user.email}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                      <span className="font-semibold">{log.entity}</span>
                      <span className="text-xs ml-2 text-slate-400">({log.entityId.substring(0,8)}...)</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 font-mono">
                      {log.ip || "Desconhecido"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {/* FOOTER / PAGINAÇÃO */}
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex items-center justify-between">
          <div className="text-sm text-slate-500">
            {isPending ? "Processando..." : `Exibindo ${logs.length} registros.`}
          </div>
          {nextCursor && (
            <button
              onClick={() => fetchLogs(nextCursor)}
              disabled={isPending}
              className="inline-flex items-center px-4 py-2 border border-slate-300 text-sm font-medium rounded-md shadow-sm text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {isPending ? "Carregando..." : "Carregar Mais Antigos"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}