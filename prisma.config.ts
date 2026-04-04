import "dotenv/config";
import { defineConfig } from "prisma/config";

if (!process.env["DATABASE_URL"]) {
  throw new Error("FALHA CRÍTICA: DATABASE_URL não está definida nas variáveis de ambiente.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"], // Agora o TS para de reclamar, pois o 'if' acima já provou que não é undefined!
  },
});