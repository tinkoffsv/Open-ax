/** An expected failure with a message that is safe to show to the user. */
export class OpenAXError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAXError";
  }
}
