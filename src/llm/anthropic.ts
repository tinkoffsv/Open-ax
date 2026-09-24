/** Anthropic (Claude) implementation of LLMClient. */

import Anthropic from "@anthropic-ai/sdk";
import { LLMError, type JsonSchema, type LLMClient } from "./base.js";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export class AnthropicClient implements LLMClient {
  constructor(
    readonly model: string,
    readonly effort: string | null = null,
    private readonly client: Pick<Anthropic, "beta"> = new Anthropic(),
  ) {}

  async completeJson(system: string, user: string, schema: JsonSchema, maxTokens = 4000): Promise<any> {
    let response;
    try {
      response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
        output_config: {
          format: { type: "json_schema", schema },
          ...(this.effort ? { effort: this.effort as Effort } : {}),
        },
        betas: [FALLBACK_BETA],
        fallbacks: "default",
      });
    } catch (err) {
      throw toLLMError(err, this.model);
    }

    if (response.stop_reason === "refusal") throw new LLMError("The model declined to analyze this input.");
    if (response.stop_reason === "max_tokens") {
      throw new LLMError("The model response was cut off (max_tokens). Try a smaller diff.");
    }
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new LLMError("The model returned no text output.");
    try {
      return JSON.parse(block.text);
    } catch (err) {
      throw new LLMError(`The model returned invalid JSON: ${(err as Error).message}`);
    }
  }
}

function toLLMError(err: unknown, model: string): Error {
  if (err instanceof Anthropic.AuthenticationError) {
    return new LLMError("Anthropic rejected the credentials. Check ANTHROPIC_API_KEY.");
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new LLMError(`Model \`${model}\` was not found. Set OPENAX_MODEL or .openax/config.json.`);
  }
  if (err instanceof Anthropic.RateLimitError) return new LLMError("Anthropic rate limit reached. Try again shortly.");
  if (err instanceof Anthropic.APIConnectionError) {
    return new LLMError(`Could not reach the Anthropic API: ${err.message}`);
  }
  if (err instanceof Anthropic.APIError) return new LLMError(`Anthropic API error (${err.status}): ${err.message}`);
  // The SDK throws a plain Error at request time when no credentials can be resolved.
  if (err instanceof Error && err.message.includes("Could not resolve authentication method")) {
    return new LLMError("No Anthropic credentials found. Set ANTHROPIC_API_KEY (or log in with `ant auth login`).");
  }
  return err instanceof Error ? err : new Error(String(err));
}
