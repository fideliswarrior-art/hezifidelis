/**
 * ============================================================================
 * HEZI TECH — Catálogo Central de Eventos de Auditoria
 * ============================================================================
 * Arquivo: lib/security/audit/audit.events.ts
 * Camada de Defesa: C12 (Observabilidade)
 *
 * REGRAS:
 *   1. Todo evento DEVE ser referenciado pelo alias AUDIT_EVENTS (tipado).
 *   2. Valores são SCREAMING_SNAKE_CASE por domínio.
 *   3. Eventos são IMUTÁVEIS após criação — nunca renomear valores em
 *      produção (quebraria queries históricas no AuditLog).
 *   4. Novas adições vão no bloco do domínio correto, nunca no fim solto.
 *
 * HISTÓRICO:
 *   Fase 1     — AUTH_*, ROLE_*, USER_*
 *   Fase 1.5   — SESSION_*
 *   Onda 1     — MATCH_*, DRAFT_*, ORDER_*, TICKET_*, DONATION_*, CAMPAIGN_*
 *   Onda 2     — KEY_ROTATION, ENCRYPTION_*, CONSENT_*, DATA_*, LGPD_*,
 *                MEDIA_REJECTED, PARENTAL_CONSENT_VERIFY
 *   E3.1       — SEASON_*, SPLIT_*, PHASE_*, GROUP_*, TEAM_GROUP_*
 *   E3.2       — TEAM_*, PLAYER_*, CONTRACT_*, ROSTER_*
 *   E3.3 (prep)— MATCH_OFFICIAL_REMOVE
 *   E3.3.5 (prep) — PLAYER_CHECK_IN_*
 *   E3.4 (prep)— STANDING_RECALCULATE
 * ============================================================================
 */

export const AuditEvent = {
  // ─────────────────────────────────────────────────────────
  // AUTENTICAÇÃO E SESSÃO (Fase 1 / 1.5)
  // ─────────────────────────────────────────────────────────
  AUTH_LOGIN: "AUTH_LOGIN",
  AUTH_LOGIN_FAILED: "AUTH_LOGIN_FAILED",
  AUTH_LOGOUT: "AUTH_LOGOUT",
  AUTH_REFRESH: "AUTH_REFRESH",
  AUTH_RESET_PASSWORD: "AUTH_RESET_PASSWORD",
  AUTH_VERIFY_EMAIL: "AUTH_VERIFY_EMAIL",
  SESSION_INVALIDATE_ALL: "SESSION_INVALIDATE_ALL",

  // ─────────────────────────────────────────────────────────
  // USUÁRIOS E PAPÉIS (Fase 1)
  // ─────────────────────────────────────────────────────────
  ROLE_ASSIGN: "ROLE_ASSIGN",
  USER_DEACTIVATE: "USER_DEACTIVATE",
  USER_REACTIVATE: "USER_REACTIVATE",
  USER_PROFILE_UPDATE: "USER_PROFILE_UPDATE",

  // ─────────────────────────────────────────────────────────
  // LIGA E ESTRUTURA — Season / Split / Phase / Group (E3.1)
  // ─────────────────────────────────────────────────────────
  SEASON_CREATE: "SEASON_CREATE",
  SEASON_UPDATE: "SEASON_UPDATE",
  SEASON_ACTIVATE: "SEASON_ACTIVATE",
  SEASON_DEACTIVATE: "SEASON_DEACTIVATE",
  SEASON_DELETE: "SEASON_DELETE",

  SPLIT_CREATE: "SPLIT_CREATE",
  SPLIT_UPDATE: "SPLIT_UPDATE",
  SPLIT_ACTIVATE: "SPLIT_ACTIVATE",
  SPLIT_DEACTIVATE: "SPLIT_DEACTIVATE",
  SPLIT_DELETE: "SPLIT_DELETE",

  PHASE_CREATE: "PHASE_CREATE",
  PHASE_UPDATE: "PHASE_UPDATE",
  PHASE_REORDER: "PHASE_REORDER",
  PHASE_DELETE: "PHASE_DELETE",

  GROUP_CREATE: "GROUP_CREATE",
  GROUP_UPDATE: "GROUP_UPDATE",
  GROUP_DELETE: "GROUP_DELETE",
  TEAM_GROUP_ASSIGN: "TEAM_GROUP_ASSIGN",
  TEAM_GROUP_REMOVE: "TEAM_GROUP_REMOVE",

  PLAYOFF_SERIES_CREATE: "PLAYOFF_SERIES_CREATE",

  // ─────────────────────────────────────────────────────────
  // TIMES (E3.2)
  // ─────────────────────────────────────────────────────────
  TEAM_CREATE: "TEAM_CREATE",
  TEAM_UPDATE: "TEAM_UPDATE",
  TEAM_DEACTIVATE: "TEAM_DEACTIVATE",
  TEAM_REACTIVATE: "TEAM_REACTIVATE",
  TEAM_DELETE: "TEAM_DELETE",
  TEAM_SOCIAL_UPSERT: "TEAM_SOCIAL_UPSERT",
  TEAM_SOCIAL_REMOVE: "TEAM_SOCIAL_REMOVE",

  // ─────────────────────────────────────────────────────────
  // JOGADORES (E3.2)
  // ─────────────────────────────────────────────────────────
  PLAYER_CREATE: "PLAYER_CREATE",
  PLAYER_UPDATE: "PLAYER_UPDATE",
  PLAYER_STATUS_CHANGE: "PLAYER_STATUS_CHANGE",
  PLAYER_DELETE: "PLAYER_DELETE",
  PLAYER_SOCIAL_UPSERT: "PLAYER_SOCIAL_UPSERT",
  PLAYER_SOCIAL_REMOVE: "PLAYER_SOCIAL_REMOVE",
  PLAYER_TRANSFER: "PLAYER_TRANSFER",

  // ─────────────────────────────────────────────────────────
  // CONTRATOS E ROSTER (E3.2)
  // ─────────────────────────────────────────────────────────
  CONTRACT_CREATE: "CONTRACT_CREATE",
  CONTRACT_CLOSE: "CONTRACT_CLOSE",
  ROSTER_SNAPSHOT_GENERATED: "ROSTER_SNAPSHOT_GENERATED",

  // ─────────────────────────────────────────────────────────
  // PARTIDAS E SCOREBOOK (Onda 1 guards + E3.3)
  // ─────────────────────────────────────────────────────────
  MATCH_CREATE: "MATCH_CREATE",
  MATCH_OFFICIAL_ASSIGN: "MATCH_OFFICIAL_ASSIGN",
  MATCH_OFFICIAL_REMOVE: "MATCH_OFFICIAL_REMOVE",
  MATCH_START: "MATCH_START",
  MATCH_EVENT_VOID: "MATCH_EVENT_VOID",
  MATCH_FINISH: "MATCH_FINISH",
  MATCH_CANCEL: "MATCH_CANCEL",
  MATCH_POSTPONE: "MATCH_POSTPONE",
  MATCH_STATUS_REVERT: "MATCH_STATUS_REVERT",

  // ─────────────────────────────────────────────────────────
  // CHECK-IN DE JOGADOR (E3.3.5)
  // ─────────────────────────────────────────────────────────
  PLAYER_CHECK_IN: "PLAYER_CHECK_IN",
  PLAYER_CHECK_IN_DUPLICATE: "PLAYER_CHECK_IN_DUPLICATE",
  PLAYER_CHECK_IN_OUT_OF_WINDOW: "PLAYER_CHECK_IN_OUT_OF_WINDOW",

  // ─────────────────────────────────────────────────────────
  // ESTATÍSTICAS E MVP (E3.4)
  // ─────────────────────────────────────────────────────────
  MVP_STATS_COMPUTED: "MVP_STATS_COMPUTED",
  MVP_INSTAGRAM_IMPORT: "MVP_INSTAGRAM_IMPORT",
  MVP_ADMIN_OVERRIDE: "MVP_ADMIN_OVERRIDE",
  STATS_RECALCULATE: "STATS_RECALCULATE",
  STANDING_RECALCULATE: "STANDING_RECALCULATE",

  // ─────────────────────────────────────────────────────────
  // DRAFT (Onda 5+)
  // ─────────────────────────────────────────────────────────
  DRAFT_CREATE: "DRAFT_CREATE",
  DRAFT_STATUS_CHANGE: "DRAFT_STATUS_CHANGE",
  DRAFT_PICK: "DRAFT_PICK",

  // ─────────────────────────────────────────────────────────
  // INSCRIÇÕES EM EVENTOS (Onda 4+)
  // ─────────────────────────────────────────────────────────
  REGISTRATION_CREATE: "REGISTRATION_CREATE",
  REGISTRATION_STATUS_CHANGE: "REGISTRATION_STATUS_CHANGE",

  // ─────────────────────────────────────────────────────────
  // AÇÃO SOCIAL E DOAÇÕES (Onda 4+)
  // ─────────────────────────────────────────────────────────
  CAMPAIGN_CREATE: "CAMPAIGN_CREATE",
  CAMPAIGN_UPDATE_PUBLISH: "CAMPAIGN_UPDATE_PUBLISH",
  DONATION_RECEIVED: "DONATION_RECEIVED",
  DONATION_CONFIRM: "DONATION_CONFIRM",
  CAMPAIGN_GOAL_REACHED: "CAMPAIGN_GOAL_REACHED",

  // ─────────────────────────────────────────────────────────
  // E-COMMERCE E INGRESSOS (Onda 4+)
  // ─────────────────────────────────────────────────────────
  ORDER_CREATE: "ORDER_CREATE",
  ORDER_STATUS_CHANGE: "ORDER_STATUS_CHANGE",
  ORDER_REFUND: "ORDER_REFUND",
  COUPON_CREATE: "COUPON_CREATE",
  COUPON_APPLIED: "COUPON_APPLIED",
  TICKET_GENERATE: "TICKET_GENERATE",
  TICKET_VALIDATE: "TICKET_VALIDATE",
  TICKET_REVERT: "TICKET_REVERT",

  // ─────────────────────────────────────────────────────────
  // CONTEÚDO E PATROCINADORES (Onda 5+)
  // ─────────────────────────────────────────────────────────
  ARTICLE_PUBLISH: "ARTICLE_PUBLISH",
  ARTICLE_UNPUBLISH: "ARTICLE_UNPUBLISH",
  COMMENT_DELETE: "COMMENT_DELETE",
  MEDIA_UPLOAD: "MEDIA_UPLOAD",
  MEDIA_REJECTED: "MEDIA_REJECTED",
  MEDIA_DELETE: "MEDIA_DELETE",
  SPONSOR_CREATE: "SPONSOR_CREATE",
  SPONSOR_LINK_TEAM: "SPONSOR_LINK_TEAM",
  SPONSOR_LINK_LEAGUE: "SPONSOR_LINK_LEAGUE",

  // ─────────────────────────────────────────────────────────
  // CRIPTOGRAFIA / SEGURANÇA (Onda 2 — E2.5)
  // ─────────────────────────────────────────────────────────
  KEY_ROTATION: "KEY_ROTATION",
  ENCRYPTION_FAILURE: "ENCRYPTION_FAILURE",
  TWO_FACTOR_ENCRYPTED: "TWO_FACTOR_ENCRYPTED",

  // ─────────────────────────────────────────────────────────
  // PRIVACIDADE / LGPD (Onda 2 — E2.6)
  // ─────────────────────────────────────────────────────────
  CONSENT_GRANT: "CONSENT_GRANT",
  CONSENT_REVOKE: "CONSENT_REVOKE",
  DATA_EXPORT: "DATA_EXPORT",
  USER_DATA_CORRECT: "USER_DATA_CORRECT",
  USER_ANONYMIZE: "USER_ANONYMIZE",
  LGPD_INCIDENT_REGISTER: "LGPD_INCIDENT_REGISTER",
  LGPD_INCIDENT_READ: "LGPD_INCIDENT_READ",
  PARENTAL_CONSENT_VERIFY: "PARENTAL_CONSENT_VERIFY",

  // ─────────────────────────────────────────────────────────
  // AUDITORIA / SISTEMA (Fase 1 + E2.4)
  // ─────────────────────────────────────────────────────────
  AUDIT_READ: "AUDIT_READ",
  AUDIT_EXPORT: "AUDIT_EXPORT",
} as const;

// Alias para retrocompatibilidade com upload.service.ts e demais consumers
export const AUDIT_EVENTS = AuditEvent;

export type AuditEventType = keyof typeof AuditEvent;
