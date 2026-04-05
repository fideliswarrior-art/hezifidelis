import { z } from "zod";

/**
 * Validação padrão de E-mail.
 * Além de checar o formato, aplica transformações para garantir
 * que o dado chegue limpo ao banco de dados (lowercase e sem espaços).
 */
export const emailSchema = z
  .string({ message: "O e-mail deve ser um texto válido." })
  .min(1, "O e-mail é obrigatório.")
  .email("Formato de e-mail inválido.")
  .transform((str) => str.toLowerCase().trim());

/**
 * Validação de Senha para Login.
 * No login, não precisamos checar regras de complexidade (isso só atrasa a requisição),
 * apenas garantir que o usuário digitou algo.
 */
export const passwordLoginSchema = z
  .string({ message: "A senha deve ser um texto válido." })
  .min(1, "A senha é obrigatória.");

/**
 * Validação Forte de Senha (Para Cadastro e Reset).
 * Garante entropia mínima para evitar senhas fáceis de quebrar.
 */
export const strongPasswordSchema = z
  .string({ message: "A senha deve ser um texto válido." })
  .min(10, "A senha deve ter pelo menos 10 caracteres.")
  .regex(/[A-Z]/, "A senha deve conter pelo menos uma letra maiúscula.")
  .regex(/[a-z]/, "A senha deve conter pelo menos uma letra minúscula.")
  .regex(/[0-9]/, "A senha deve conter pelo menos um número.")
  .regex(/[\W_]/, "A senha deve conter pelo menos um caractere especial.")
  .max(32, "A senha é muito longa.");