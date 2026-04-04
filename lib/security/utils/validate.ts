import { z } from "zod";

export class ValidationError extends Error {
  public issues: z.ZodIssue[];
  
  constructor(issues: z.ZodIssue[]) {
    super("Dados inválidos fornecidos na requisição.");
    this.name = "ValidationError";
    this.issues = issues;
  }
}

/**
 * Filtra e valida um payload de entrada de acordo com um Schema Zod.
 * Exclui automaticamente propriedades não declaradas (previne mass assignment).
 */
export function validatePayload<T>(schema: z.Schema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  
  if (!result.success) {
    throw new ValidationError(result.error.issues);
  }
  
  return result.data;
}