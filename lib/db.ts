import { PrismaClient } from "@prisma/client";

// Essa validação garante que o app exploda na hora de iniciar
// caso a URL não esteja no .env (fail-secure).
if (!process.env.DATABASE_URL) {
  throw new Error("FALHA CRÍTICA: DATABASE_URL não definida nas variáveis de ambiente.");
}

// Instanciando o Prisma V7 (ele lerá do env automaticamente agora que garantimos que existe)
const prismaClientSingleton = () => {
  return new PrismaClient();
};

type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>;

// Prevenindo múltiplas conexões no Next.js Dev Mode (Hot Reload)
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientSingleton | undefined;
};

export const db = globalForPrisma.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}