export class ConversationExportError extends Error {
  readonly errors: string[];

  constructor(message: string, errors: string[] = [message]) {
    super(message);
    this.name = "ConversationExportError";
    this.errors = errors;
  }
}
