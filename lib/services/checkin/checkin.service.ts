// lib/services/checkin/checkin.service.ts

import { db } from "@/lib/db";
import { CheckInMethod, MatchStatus, Prisma } from "@prisma/client";
import { createAuditLog } from "@/lib/security/audit/audit.service";
import { AUDIT_EVENTS } from "@/lib/security/audit/audit.events";
import { hashForAudit } from "@/lib/security/crypto/qrcode";
import { getClientIp } from "@/lib/security/utils/get-ip";
import {
  CheckInWindowError,
  DuplicateCheckInError,
  NotFoundError,
  ForbiddenError,
} from "@/lib/security/utils/errors";
import type {
  ScanCheckInInput,
  ManualCheckInInput,
  ListCheckInsQuery,
} from "@/lib/security/utils/validations.checkin";
import { sanitizePlainText } from "@/lib/security/content/sanitize";

// ─── Configuração de janela temporal ─────────────────────────
const WINDOW_OPENS_BEFORE_MS =
  parseInt(process.env.CHECKIN_WINDOW_OPENS_MINUTES_BEFORE ?? "120", 10) *
  60_000;

const WINDOW_CLOSES_AFTER_START_MS =
  parseInt(process.env.CHECKIN_WINDOW_CLOSES_MINUTES_AFTER_START ?? "15", 10) *
  60_000;

// ─── Tipos internos ─────────────────────────────────────────
interface ActorContext {
  userId: string;
  role: string;
}

interface CheckInData {
  playerId: string;
  matchId: string | null;
  splitId: string | null;
  method: CheckInMethod;
  qrCodeHash: string | null;
  notes: string | null;
}

// ─── Helpers privados ────────────────────────────────────────

/**
 * Valida se o momento atual está dentro da janela de check-in
 * da partida. Só se aplica quando o escopo é matchId.
 *
 * Janela abre: scheduledFor - WINDOW_OPENS_BEFORE_MS
 * Janela fecha:
 *   - Se LIVE: startedAt + WINDOW_CLOSES_AFTER_START_MS
 *   - Se SCHEDULED: janela está aberta (partida ainda não começou)
 */
function validateMatchWindow(match: {
  status: MatchStatus;
  scheduledFor: Date;
  startedAt: Date | null;
}): void {
  const now = Date.now();
  const opensAt = match.scheduledFor.getTime() - WINDOW_OPENS_BEFORE_MS;

  if (now < opensAt) {
    throw new CheckInWindowError("Check-in ainda não abriu para esta partida.");
  }

  // Se LIVE, verificar se já passou da tolerância pós-início
  if (match.status === MatchStatus.LIVE && match.startedAt) {
    const closesAt = match.startedAt.getTime() + WINDOW_CLOSES_AFTER_START_MS;

    if (now > closesAt) {
      throw new CheckInWindowError(
        "Janela de check-in encerrada após início da partida.",
      );
    }
  }
}

/**
 * Valida e carrega o contexto do match para check-in.
 * Retorna o match e o splitId derivado.
 */
async function resolveMatchContext(matchId: string) {
  const match = await db.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      status: true,
      scheduledFor: true,
      startedAt: true,
      homeTeamId: true,
      awayTeamId: true,
      phaseId: true,
      groupId: true,
      phase: { select: { splitId: true } },
      group: { select: { phase: { select: { splitId: true } } } },
    },
  });

  if (!match) {
    throw new NotFoundError("Partida não encontrada.");
  }

  const allowedStatuses: MatchStatus[] = [
    MatchStatus.SCHEDULED,
    MatchStatus.LIVE,
  ];

  if (!allowedStatuses.includes(match.status)) {
    throw new CheckInWindowError(
      `Check-in não permitido para partida com status ${match.status}.`,
    );
  }

  validateMatchWindow(match);

  // Derivar splitId: Phase → Split ou Group → Phase → Split
  const splitId = match.phase?.splitId ?? match.group?.phase?.splitId ?? null;

  return { match, splitId };
}

/**
 * Valida que o split existe e está ativo.
 */
async function resolveSplitContext(splitId: string) {
  const split = await db.split.findUnique({
    where: { id: splitId },
    select: { id: true, isActive: true, seasonId: true },
  });

  if (!split) {
    throw new NotFoundError("Split não encontrado.");
  }

  if (!split.isActive) {
    throw new CheckInWindowError("Split não está ativo.");
  }

  return split;
}

/**
 * Valida que o jogador tem contrato ativo no escopo.
 *
 * - matchId: contrato ativo em um dos times da partida + no split da partida
 * - splitId: contrato ativo em qualquer time do split
 *
 * Retorna { teamId } do contrato encontrado.
 */
async function validatePlayerEligibility(
  playerId: string,
  options: {
    splitId: string | null;
    homeTeamId?: string;
    awayTeamId?: string;
  },
) {
  const where: Prisma.PlayerContractWhereInput = {
    playerId,
    endDate: null, // contrato ativo
  };

  // Se há splitId, escopo por split
  if (options.splitId) {
    where.splitId = options.splitId;
  }

  // Se é match-scoped, exigir que o time seja um dos da partida
  if (options.homeTeamId && options.awayTeamId) {
    where.teamId = { in: [options.homeTeamId, options.awayTeamId] };
  }

  const contract = await db.playerContract.findFirst({
    where,
    select: { teamId: true },
  });

  if (!contract) {
    throw new ForbiddenError("Jogador não possui contrato ativo neste escopo.");
  }

  return { teamId: contract.teamId };
}

/**
 * Núcleo transacional: verifica duplicata + insere + audita.
 * Chamado tanto por scanCheckIn quanto por manualCheckIn.
 */
async function performCheckIn(
  actor: ActorContext,
  data: CheckInData,
  ip: string | null,
) {
  return db.$transaction(async (tx) => {
    // ── Anti-duplicata com lock ──────────────────────────
    const existing = data.matchId
      ? await tx.playerCheckIn.findUnique({
          where: {
            playerId_matchId: {
              playerId: data.playerId,
              matchId: data.matchId,
            },
          },
          select: { id: true },
        })
      : await tx.playerCheckIn.findUnique({
          where: {
            playerId_splitId: {
              playerId: data.playerId,
              splitId: data.splitId!,
            },
          },
          select: { id: true },
        });

    if (existing) {
      // Audit detetivo — logar tentativa duplicada
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: AUDIT_EVENTS.PLAYER_CHECK_IN_DUPLICATE,
          entity: "PlayerCheckIn",
          entityId: existing.id,
          before: Prisma.DbNull,
          after: Prisma.DbNull,
          ip,
          metadata: {
            playerId: data.playerId,
            matchId: data.matchId,
            splitId: data.splitId,
          },
        },
      });

      throw new DuplicateCheckInError();
    }

    // ── Criar check-in ──────────────────────────────────
    // ── Sanitização C10 ─────────────────────────────────
    const sanitizedNotes = data.notes
      ? sanitizePlainText(data.notes, 500)
      : null;

    const checkIn = await tx.playerCheckIn.create({
      data: {
        playerId: data.playerId,
        matchId: data.matchId,
        splitId: data.splitId,
        checkedInById: actor.userId,
        method: data.method,
        ip,
        notes: sanitizedNotes,
      },
      select: {
        id: true,
        checkedInAt: true,
        method: true,
        player: {
          select: { firstName: true, lastName: true },
        },
      },
    });

    // ── Audit ───────────────────────────────────────────
    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: AUDIT_EVENTS.PLAYER_CHECK_IN,
        entity: "PlayerCheckIn",
        entityId: checkIn.id,
        before: Prisma.DbNull,
        after: {
          playerId: data.playerId,
          matchId: data.matchId,
          splitId: data.splitId,
          method: data.method,
          checkedInAt: checkIn.checkedInAt,
        },
        ip,
        metadata: {
          qrCodeHash: data.qrCodeHash,
        },
      },
    });

    return checkIn;
  });
}

// ─── Funções públicas ────────────────────────────────────────

/**
 * Check-in via scan de QR do jogador.
 *
 * Fluxo:
 * 1. Resolver jogador pelo qrCode
 * 2. Resolver contexto (match ou split)
 * 3. Validar elegibilidade (contrato ativo)
 * 4. Verificar autorização do operador
 * 5. Executar check-in transacional
 */
export async function scanCheckIn(
  actor: ActorContext,
  input: ScanCheckInInput,
) {
  const ip = await getClientIp().catch(() => null);

  // ── 1. Resolver jogador pelo QR ───────────────────────
  const player = await db.player.findUnique({
    where: { checkInQrCode: input.qrCode },
    select: {
      id: true,
      status: true,
      userId: true,
      firstName: true,
      lastName: true,
    },
  });

  if (!player) {
    // Audit detetivo — QR não reconhecido
    await createAuditLog({
      userId: actor.userId,
      action: AUDIT_EVENTS.PLAYER_CHECK_IN_OUT_OF_WINDOW,
      entity: "PlayerCheckIn",
      entityId: "unknown",
      before: null,
      after: null,
      ip,
      metadata: {
        reason: "QR não corresponde a nenhum jogador.",
        qrCodeHash: hashForAudit(input.qrCode),
      },
    });

    throw new NotFoundError("QR Code não reconhecido.");
  }

  // ── 2. Resolver contexto ──────────────────────────────
  let splitId: string | null = null;
  let homeTeamId: string | undefined;
  let awayTeamId: string | undefined;

  if (input.matchId) {
    const ctx = await resolveMatchContext(input.matchId);
    splitId = ctx.splitId;
    homeTeamId = ctx.match.homeTeamId;
    awayTeamId = ctx.match.awayTeamId;
  }

  if (input.splitId) {
    await resolveSplitContext(input.splitId);
    splitId = input.splitId;
  }

  // ── 3. Elegibilidade ──────────────────────────────────
  await validatePlayerEligibility(player.id, {
    splitId,
    ...(homeTeamId != null && { homeTeamId }),
    ...(awayTeamId != null && { awayTeamId }),
  });

  // ── 4. Executar ───────────────────────────────────────
  return performCheckIn(
    actor,
    {
      playerId: player.id,
      matchId: input.matchId ?? null,
      splitId: input.splitId ?? null,
      method: CheckInMethod.QR_SCAN,
      qrCodeHash: hashForAudit(input.qrCode),
      notes: input.notes ?? null,
    },
    ip,
  );
}

/**
 * Check-in manual por admin (sem QR).
 * Apenas ADMIN+ pode executar.
 */
export async function manualCheckIn(
  actor: ActorContext,
  input: ManualCheckInInput,
) {
  const ip = await getClientIp().catch(() => null);

  // ── 1. Verificar jogador existe ───────────────────────
  const player = await db.player.findUnique({
    where: { id: input.playerId },
    select: { id: true, status: true },
  });

  if (!player) {
    throw new NotFoundError("Jogador não encontrado.");
  }

  // ── 2. Resolver contexto ──────────────────────────────
  let splitId: string | null = null;
  let homeTeamId: string | undefined;
  let awayTeamId: string | undefined;

  if (input.matchId) {
    const ctx = await resolveMatchContext(input.matchId);
    splitId = ctx.splitId;
    homeTeamId = ctx.match.homeTeamId;
    awayTeamId = ctx.match.awayTeamId;
  }

  if (input.splitId) {
    await resolveSplitContext(input.splitId);
    splitId = input.splitId;
  }

  // ── 3. Elegibilidade ──────────────────────────────────
  await validatePlayerEligibility(player.id, {
    splitId,
    ...(homeTeamId != null && { homeTeamId }),
    ...(awayTeamId != null && { awayTeamId }),
  });
  // ── 4. Executar ───────────────────────────────────────
  return performCheckIn(
    actor,
    {
      playerId: input.playerId,
      matchId: input.matchId ?? null,
      splitId: input.splitId ?? null,
      method: CheckInMethod.MANUAL_ADMIN,
      qrCodeHash: null,
      notes: input.notes ?? null,
    },
    ip,
  );
}

/**
 * Lista check-ins por partida ou split.
 *
 * Retorna dados do jogador + time (derivado do contrato).
 * IP mascarado para privacidade (apenas último octeto).
 */
export async function listCheckIns(query: ListCheckInsQuery) {
  const where: Prisma.PlayerCheckInWhereInput = {};

  if (query.matchId) where.matchId = query.matchId;
  if (query.splitId) where.splitId = query.splitId;

  const checkIns = await db.playerCheckIn.findMany({
    where,
    orderBy: { checkedInAt: "asc" },
    select: {
      id: true,
      checkedInAt: true,
      method: true,
      notes: true,
      ip: true,
      player: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          nickname: true,
          jerseyNumber: false,
        },
      },
      checkedInBy: {
        select: { name: true },
      },
    },
  });

  // Mascarar IP — mostrar apenas último octeto (ex: xxx.xxx.xxx.42)
  return checkIns.map((ci) => ({
    ...ci,
    ip: ci.ip ? ci.ip.replace(/\d+\.\d+\.\d+\./, "xxx.xxx.xxx.") : null,
  }));
}
