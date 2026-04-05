"use client";

import { useState } from "react";
import Link from "next/link";
import { secureFetch } from "../../../lib/utils/secure-fetch";

export default function RegisterPage() {
  const [step, setStep] = useState<"FORM" | "SUCCESS">("FORM");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const criteria = {
    length: password.length >= 10,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };

  const isPasswordStrong = Object.values(criteria).every(Boolean);
  const passwordsMatch = password === confirmPassword && password.length > 0;

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!isPasswordStrong) {
      setError("A senha não atinge os requisitos mínimos de segurança.");
      return;
    }

    if (!passwordsMatch) {
      setError("As senhas não coincidem.");
      return;
    }

    setLoading(true);

    try {
      const res = await secureFetch("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Ocorreu um erro ao processar seu cadastro.");
      }

      setStep("SUCCESS");
      
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black p-4">
      <div className="max-w-md w-full bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-800 p-6 sm:p-8">
        
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-white tracking-tight uppercase italic">HEZI<span className="text-zinc-500">TECH</span></h1>
          <p className="text-zinc-400 mt-2 text-sm font-medium">Junte-se à maior liga comunitária</p>
        </div>

        {/* --- TELA DE SUCESSO --- */}
        {step === "SUCCESS" && (
          <div className="text-center py-6">
            <div className="mx-auto w-16 h-16 bg-green-900/30 text-green-400 rounded-full flex items-center justify-center mb-6 border border-green-500/20">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Verifique seu e-mail</h2>
            <p className="text-zinc-400 mb-6 text-sm">
              Se os dados estiverem corretos, enviamos um link mágico de ativação para <strong className="text-white">{email}</strong>. 
              Você precisa clicar nele para ativar sua conta antes de fazer o login.
            </p>
            <Link 
              href="/login" 
              className="w-full block bg-white text-black font-bold p-3 rounded-lg hover:bg-zinc-200 transition-all shadow-md"
            >
              Ir para o Login
            </Link>
          </div>
        )}

        {/* --- TELA DO FORMULÁRIO --- */}
        {step === "FORM" && (
          <>
            {error && (
              <div className="mb-6 p-4 bg-red-900/30 border border-red-500/50 text-red-400 rounded-lg text-sm font-medium">
                {error}
              </div>
            )}

            <form onSubmit={handleRegisterSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-zinc-300 mb-1">Nome Completo</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-600 focus:ring-2 focus:ring-white focus:border-transparent transition-all outline-none"
                  placeholder="Seu nome"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-zinc-300 mb-1">E-mail</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-600 focus:ring-2 focus:ring-white focus:border-transparent transition-all outline-none"
                  placeholder="seu@email.com"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-zinc-300 mb-1">Crie uma Senha</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-white placeholder-zinc-600 focus:ring-2 focus:ring-white focus:border-transparent transition-all outline-none"
                  placeholder="••••••••"
                />
                
                {/* Indicador de Força de Senha (Dark Mode) */}
                <div className="mt-3 bg-zinc-950 p-4 rounded-lg border border-zinc-800/50">
                  <p className="text-xs font-bold text-zinc-500 mb-3 uppercase tracking-wider">Requisitos de Segurança</p>
                  <ul className="text-xs space-y-2 font-medium">
                    <li className={`flex items-center gap-2 ${criteria.length ? "text-green-400" : "text-zinc-500"}`}>
                      {criteria.length ? "✓" : "○"} Mínimo de 10 caracteres
                    </li>
                    <li className={`flex items-center gap-2 ${criteria.uppercase ? "text-green-400" : "text-zinc-500"}`}>
                      {criteria.uppercase ? "✓" : "○"} Uma letra maiúscula
                    </li>
                    <li className={`flex items-center gap-2 ${criteria.lowercase ? "text-green-400" : "text-zinc-500"}`}>
                      {criteria.lowercase ? "✓" : "○"} Uma letra minúscula
                    </li>
                    <li className={`flex items-center gap-2 ${criteria.number ? "text-green-400" : "text-zinc-500"}`}>
                      {criteria.number ? "✓" : "○"} Um número
                    </li>
                    <li className={`flex items-center gap-2 ${criteria.special ? "text-green-400" : "text-zinc-500"}`}>
                      {criteria.special ? "✓" : "○"} Um símbolo especial (!@#$...)
                    </li>
                  </ul>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-zinc-300 mb-1">Confirme a Senha</label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={`w-full p-3 bg-zinc-950 border rounded-lg text-white placeholder-zinc-600 transition-all outline-none ${
                    confirmPassword.length > 0 && !passwordsMatch 
                      ? "border-red-500/50 focus:ring-2 focus:ring-red-500" 
                      : "border-zinc-800 focus:ring-2 focus:ring-white focus:border-transparent"
                  }`}
                  placeholder="••••••••"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !isPasswordStrong || !passwordsMatch}
                className="w-full bg-white text-black font-black uppercase tracking-wider p-4 rounded-lg hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg mt-6"
              >
                {loading ? "Criando Conta..." : "Criar Conta"}
              </button>

              <p className="text-center text-sm font-medium text-zinc-400 mt-6">
                Já possui uma conta? <Link href="/login" className="text-white hover:underline">Fazer login</Link>
              </p>
            </form>
          </>
        )}

      </div>
    </div>
  );
}