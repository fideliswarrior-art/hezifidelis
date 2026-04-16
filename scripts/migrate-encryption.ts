import { db } from "@/lib/db";
import { encrypt, isEncrypted } from "@/lib/security/crypto/encryption";
import { createAuditLog } from "@/lib/security/audit/audit.service";
import { AUDIT_EVENTS } from "@/lib/security/audit/audit.events";

/**
 * ============================================================================
 * SCRIPT: Migração de Criptografia em Lote (E2.5)
 * ============================================================================
 * OBJETIVO:
 * Varrer o banco de dados em busca de campos sensíveis (PII/Segredos) que
 * ainda estejam em texto plano e criptografá-los utilizando AES-256-GCM.
 * * USO:
 * npx tsx scripts/migrate-encryption.ts
 * * IDEMPOTÊNCIA:
 * É seguro rodar este script múltiplas vezes. Ele ignora automaticamente
 * os registros que já possuem o prefixo de criptografia.
 * ============================================================================
 */

const BATCH_SIZE = 500;

// Função auxiliar para dividir arrays em lotes menores
function chunkArray<T>(array: T[], size: number): T[][] {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

async function migrateUsers() {
  console.log("🔍 Verificando User.twoFactorSecret...");
  let processed = 0;
  let failed = 0;

  // Busca apenas usuários que têm o 2FA ativado/configurado
  const users = await db.user.findMany({
    where: { twoFactorSecret: { not: null } },
    select: { id: true, twoFactorSecret: true },
  });

  // Filtra apenas os que AINDA NÃO estão criptografados
  const usersToMigrate = users.filter(
    (u) => u.twoFactorSecret && !isEncrypted(u.twoFactorSecret),
  );

  if (usersToMigrate.length === 0) {
    console.log("✅ Nenhum usuário precisa de migração.");
    return { processed, failed };
  }

  console.log(
    `⏳ Encontrados ${usersToMigrate.length} usuários. Iniciando criptografia em lotes de ${BATCH_SIZE}...`,
  );

  const batches = chunkArray(usersToMigrate, BATCH_SIZE);

  for (const batch of batches) {
    await db.$transaction(async (tx) => {
      for (const user of batch) {
        try {
          if (!user.twoFactorSecret) continue;

          const encryptedSecret = await encrypt(user.twoFactorSecret);

          await tx.user.update({
            where: { id: user.id },
            data: { twoFactorSecret: encryptedSecret },
          });

          processed++;
        } catch (error: any) {
          failed++;
          console.error(
            `❌ Falha ao encriptar user ${user.id}:`,
            error.message,
          );

          // Gera log de auditoria da falha sem expor o dado sensível
          await createAuditLog({
            userId: user.id, // O próprio usuário como ator do erro
            action: AUDIT_EVENTS.ENCRYPTION_FAILURE as any,
            entity: "User",
            entityId: user.id,
            metadata: { field: "twoFactorSecret", error: error.message },
          }).catch(() => {}); // Ignora erro de auditoria para não travar o loop
        }
      }
    });
  }

  return { processed, failed };
}

async function migrateTickets() {
  console.log("🔍 Verificando Ticket.holderDocument...");
  let processed = 0;
  let failed = 0;

  // Busca ingressos nominais
  const tickets = await db.ticket.findMany({
    where: { holderDocument: { not: null } },
    select: { id: true, holderDocument: true, userId: true },
  });

  const ticketsToMigrate = tickets.filter(
    (t) => t.holderDocument && !isEncrypted(t.holderDocument),
  );

  if (ticketsToMigrate.length === 0) {
    console.log("✅ Nenhum ingresso precisa de migração.");
    return { processed, failed };
  }

  console.log(
    `⏳ Encontrados ${ticketsToMigrate.length} ingressos. Iniciando criptografia...`,
  );

  const batches = chunkArray(ticketsToMigrate, BATCH_SIZE);

  for (const batch of batches) {
    await db.$transaction(async (tx) => {
      for (const ticket of batch) {
        try {
          if (!ticket.holderDocument) continue;

          const encryptedDoc = await encrypt(ticket.holderDocument);

          await tx.ticket.update({
            where: { id: ticket.id },
            data: { holderDocument: encryptedDoc },
          });

          processed++;
        } catch (error: any) {
          failed++;
          console.error(
            `❌ Falha ao encriptar ticket ${ticket.id}:`,
            error.message,
          );

          await createAuditLog({
            userId: ticket.userId,
            action: AUDIT_EVENTS.ENCRYPTION_FAILURE as any,
            entity: "Ticket",
            entityId: ticket.id,
            metadata: { field: "holderDocument", error: error.message },
          }).catch(() => {});
        }
      }
    });
  }

  return { processed, failed };
}

async function main() {
  console.log("==================================================");
  console.log("🚀 INICIANDO MIGRAÇÃO DE CRIPTOGRAFIA DE DADOS (E2.5)");
  console.log("==================================================\n");

  const startTime = Date.now();

  const userResults = await migrateUsers();
  console.log("");
  const ticketResults = await migrateTickets();

  const durationSecs = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log("\n==================================================");
  console.log("📊 RELATÓRIO FINAL DA MIGRAÇÃO");
  console.log("==================================================");
  console.log(`Tempo total: ${durationSecs}s`);
  console.log(`Usuários processados com sucesso: ${userResults.processed}`);
  console.log(`Usuários que falharam: ${userResults.failed}`);
  console.log(`Ingressos processados com sucesso: ${ticketResults.processed}`);
  console.log(`Ingressos que falharam: ${ticketResults.failed}`);
  console.log("==================================================");

  process.exit(0);
}

// Executa o script
main().catch((error) => {
  console.error("❌ Erro fatal durante a execução do script:", error);
  process.exit(1);
});
