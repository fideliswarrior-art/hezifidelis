/**
 * ============================================================================
 * HEZI TECH — GERADOR DE CÓDIGO DE CONTRATO (Onda 3 - E3.2 Redesign)
 * ============================================================================
 * Arquivo: lib/services/player/contract-code.ts
 *
 * FORMATO: CON-{TEAM}{INITIALS}{JERSEY}-{SEASON_CODE}-{YYMM}{RANDOM6}
 * EXEMPLO: CON-GWARL10-CAB26-2604384729
 *
 * SEGMENTOS:
 *   CON          — Prefixo fixo (identifica entidade)
 *   {TEAM}       — shortName do time (3 chars, uppercase)
 *   {INITIALS}   — Primeira letra do firstName + lastName (2 chars, ASCII)
 *   {JERSEY}     — Número da camisa zero-padded (2 chars)
 *   {SEASON_CODE}— season.shortCode (3-8 chars, uppercase)
 *   {YYMM}       — Ano e mês de criação (4 chars)
 *   {RANDOM6}    — 6 dígitos criptograficamente aleatórios
 *
 * REGRAS:
 *   ★ Server-side only. Nunca aceitar do client.
 *   ★ Acentos são normalizados para ASCII (José → J, não Ĵ).
 *   ★ Colisão tratada pelo caller com retry (contract.service.ts).
 * ============================================================================
 */

import { randomInt } from "crypto";

// ============================================================================
// TIPOS
// ============================================================================

export interface ContractCodeInput {
  teamShortName: string | null;
  teamName: string;
  playerFirstName: string;
  playerLastName: string;
  jerseyNumber: number;
  seasonShortCode: string;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Remove diacríticos e retorna apenas caracteres ASCII A-Z.
 * "José" → "JOSE", "Ítalo" → "ITALO", "Ângelo" → "ANGELO"
 */
function toAsciiUpperCase(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

// ============================================================================
// GERADOR
// ============================================================================

export function generateContractCode(input: ContractCodeInput): string {
  // TEAM: shortName (3 chars) ou fallback das 3 primeiras letras do nome
  const team = input.teamShortName
    ? toAsciiUpperCase(input.teamShortName).padEnd(3, "X").slice(0, 3)
    : toAsciiUpperCase(input.teamName).padEnd(3, "X").slice(0, 3);

  // INITIALS: primeira letra do nome + sobrenome (ASCII normalizado)
  const firstInitial = toAsciiUpperCase(input.playerFirstName)[0] ?? "X";
  const lastInitial = toAsciiUpperCase(input.playerLastName)[0] ?? "X";
  const initials = firstInitial + lastInitial;

  // JERSEY: 2 dígitos zero-padded (0 → "00", 7 → "07", 10 → "10")
  const jersey = String(input.jerseyNumber).padStart(2, "0");

  // SEASON: código curto da temporada
  const season = input.seasonShortCode.toUpperCase();

  // YYMM: ano e mês de criação
  const now = new Date();
  const yymm =
    String(now.getFullYear()).slice(-2) +
    String(now.getMonth() + 1).padStart(2, "0");

  // RANDOM6: 6 dígitos criptograficamente seguros [100000, 999999]
  // randomInt(min, max) retorna [min, max) — por isso max = 1000000
  const random = String(randomInt(100000, 1000000));

  return `CON-${team}${initials}${jersey}-${season}-${yymm}${random}`;
}
