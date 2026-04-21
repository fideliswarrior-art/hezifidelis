export class NotFoundError extends Error {
  public readonly statusCode = 404;
  constructor(message = "Recurso não encontrado.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends Error {
  statusCode = 401;
  code = "UNAUTHORIZED";
  constructor(message = "Não autorizado. Faça login para continuar.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  statusCode = 403;
  code = "FORBIDDEN";
  constructor(message = "Acesso negado.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class ConsentError extends Error {
  public readonly statusCode = 422;
  constructor(
    message: string,
    public readonly code: string = "CONSENT_ERROR",
  ) {
    super(message);
    this.name = "ConsentError";
  }
}

export class DataSubjectError extends Error {
  public readonly statusCode = 422;
  constructor(
    message: string,
    public readonly code: string = "DATA_SUBJECT_ERROR",
  ) {
    super(message);
    this.name = "DataSubjectError";
  }
}

export class CheckInWindowError extends Error {
  statusCode = 422;
  code = "CHECK_IN_WINDOW_CLOSED";
  constructor(message = "Fora da janela de check-in.") {
    super(message);
    this.name = "CheckInWindowError";
  }
}

export class DuplicateCheckInError extends Error {
  statusCode = 409;
  code = "DUPLICATE_CHECK_IN";
  constructor(message = "Jogador já fez check-in neste escopo.") {
    super(message);
    this.name = "DuplicateCheckInError";
  }
}

// --- ERROS NOVOS ADICIONADOS ---

export class MatchNotFoundError extends Error {
  statusCode = 404;
  code = "MATCH_NOT_FOUND";
  constructor(message = "Partida não encontrada.") {
    super(message);
    this.name = "MatchNotFoundError";
  }
}

export class MatchStatusError extends Error {
  statusCode = 422;
  code = "MATCH_STATUS_ERROR";
  constructor(message = "Status da partida incompatível com a operação.") {
    super(message);
    this.name = "MatchStatusError";
  }
}
