"use client";

import { useState } from "react";
import Link from "next/link";
import { forgotPassword } from "../../../lib/actions/auth"; // Importando o Server Action

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"IDLE" | "LOADING" | "SUCCESS" | "ERROR">("IDLE");
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("LOADING");
    setErrorMessage("");

    try {
      const result = await forgotPassword({ email });

      if (result.success) {
        setStatus("SUCCESS");
      } else {
        setStatus("ERROR");
        setErrorMessage(result.error || "Ocorreu um erro ao solicitar a recuperação.");
      }
    } catch (err) {
      setStatus("ERROR");
      setErrorMessage("Erro de conexão. Tente novamente.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black p-4">
      <div className="max-w-md w-full bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-800 p-6 sm:p-8">
        
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-white tracking-tight uppercase italic">
            Recuperar <span className="text-zinc-500">Acesso</span>
          </h1>
          <p className="text-zinc-400 mt-2 text-sm font-medium">Enviaremos as instruções para o seu e-mail.</p>
        </div>

        {status === "SUCCESS" ? (
          <div className="text-center py-4">
            <div className="mx-auto w-16 h-16 bg-zinc-950 text-white rounded-full flex items-center justify-center mb-6 border border-zinc-800">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-zinc-300 text-sm font-medium mb-6">
              Se este e-mail estiver cadastrado, você receberá um link de recuperação em instantes.
            </p>
            <Link 
              href="/login" 
              className="w-full block bg-white text-black font-bold p-3 rounded-lg hover:bg-zinc-200 transition-all shadow-md uppercase tracking-wide"
            >
              Voltar para o Login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {status === "ERROR" && (
              <div className="p-4 bg-red-900/30 border border-red-500/50 text-red-400 rounded-lg text-sm font-medium text-center">
                {errorMessage}
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-zinc-300 mb-1">E-mail cadastrado</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-600 focus:ring-2 focus:ring-white focus:border-transparent transition-all outline-none"
                placeholder="seu@email.com"
              />
            </div>

            <button
              type="submit"
              disabled={status === "LOADING"}
              className="w-full bg-white text-black font-black uppercase tracking-wider p-4 rounded-lg hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg mt-6"
            >
              {status === "LOADING" ? "Enviando..." : "Enviar Link"}
            </button>

            <div className="text-center mt-6">
              <Link href="/login" className="text-sm font-medium text-zinc-500 hover:text-white transition-colors">
                ← Cancelar e voltar
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}