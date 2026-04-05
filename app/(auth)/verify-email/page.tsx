"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { verifyEmail } from "../../../lib/actions/auth"; // Server Action do backend

export default function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const resolvedParams = use(searchParams);
  const token = resolvedParams.token;

  const [status, setStatus] = useState<"LOADING" | "SUCCESS" | "ERROR">("LOADING");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("ERROR");
      setErrorMessage("O link de verificação está incompleto ou inválido.");
      return;
    }

    // Chama o backend silenciosamente assim que a página carrega
    verifyEmail({ token })
      .then((res) => {
        if (res.success) {
          setStatus("SUCCESS");
        } else {
          setStatus("ERROR");
          setErrorMessage(res.error || "Erro ao verificar o e-mail.");
        }
      })
      .catch(() => {
        setStatus("ERROR");
        setErrorMessage("Erro de comunicação com o servidor. Tente novamente.");
      });
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-black p-4">
      <div className="max-w-md w-full bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-800 p-8 text-center">
        
        <h1 className="text-3xl font-black text-white tracking-tight uppercase italic mb-8">
          HEZI<span className="text-zinc-500">TECH</span>
        </h1>

        {status === "LOADING" && (
          <div className="py-6">
            <div className="animate-spin w-12 h-12 border-4 border-zinc-700 border-t-white rounded-full mx-auto mb-6"></div>
            <h2 className="text-xl font-bold text-white mb-2">Validando credenciais...</h2>
            <p className="text-zinc-400 text-sm">Por favor, aguarde enquanto verificamos seu token.</p>
          </div>
        )}

        {status === "SUCCESS" && (
          <div className="py-6">
            <div className="mx-auto w-16 h-16 bg-green-900/30 text-green-400 rounded-full flex items-center justify-center mb-6 border border-green-500/20">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">E-mail Confirmado!</h2>
            <p className="text-zinc-400 mb-6 text-sm">
              Sua conta foi ativada com sucesso. Agora você já pode fazer login e configurar seu 2FA.
            </p>
            <Link href="/login" className="w-full block bg-white text-black font-bold p-3 rounded-lg hover:bg-zinc-200 transition-all">
              Acessar Plataforma
            </Link>
          </div>
        )}

        {status === "ERROR" && (
          <div className="py-6">
            <div className="mx-auto w-16 h-16 bg-red-900/30 text-red-400 rounded-full flex items-center justify-center mb-6 border border-red-500/20">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Falha na Verificação</h2>
            <p className="text-red-400 mb-6 text-sm font-medium">{errorMessage}</p>
            <Link href="/register" className="w-full block bg-zinc-800 text-white font-bold p-3 rounded-lg hover:bg-zinc-700 transition-all">
              Voltar ao Início
            </Link>
          </div>
        )}

      </div>
    </div>
  );
}