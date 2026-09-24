/** LLM provider selection. */

import type { Config } from "../config.js";
import { LLMError, type LLMClient } from "./base.js";

export { LLMError, type LLMClient } from "./base.js";

export async function createClient(config: Config): Promise<LLMClient> {
  if (config.provider === "anthropic") {
    const { AnthropicClient } = await import("./anthropic.js");
    return new AnthropicClient(config.model, config.effort);
  }
  throw new LLMError(`Unknown LLM provider \`${config.provider}\`. Supported: anthropic.`);
}
