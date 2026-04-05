import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

if (!process.env.DATABASE_URL) {
  throw new Error("FALHA CRÍTICA: DATABASE_URL não definida nas variáveis de ambiente.");
}

const prismaClientSingleton = () => {
  // 1. Criamos um pool de conexões padrão do PostgreSQL
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  // 2. Envelopamos esse pool no adaptador oficial do Prisma
  const adapter = new PrismaPg(pool);
  
  // 3. Injetamos o adaptador no PrismaClient (Exigência do Prisma v7)
  return new PrismaClient({ adapter });
};

type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientSingleton | undefined;
};

export const db = globalForPrisma.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}