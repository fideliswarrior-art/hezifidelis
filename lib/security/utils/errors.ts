export class NotFoundError extends Error {
  public readonly statusCode = 404;
  constructor(message = "Recurso não encontrado.") {
    super(message);
    this.name = "NotFoundError";
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
