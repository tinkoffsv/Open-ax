/**
 * Provider-neutral LLM interface.
 *
 * OpenAX needs one capability from a model: given instructions and input, return a JSON
 * object matching a schema. Every analysis step (significance, relevance, conflict,
 * decision drafting) goes through `complete_json`.
 */

import { OpenAXError } from "../errors.js";

export class LLMError extends OpenAXError {}

export type JsonSchema = Record<string, unknown>;

export interface LLMClient {
  completeJson(system: string, user: string, schema: JsonSchema, maxTokens?: number): Promise<any>;
}
