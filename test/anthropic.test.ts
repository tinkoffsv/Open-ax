import { describe, expect, it } from "vitest";
import { AnthropicClient } from "../src/llm/anthropic.js";

function clientReturning(response?: unknown, error?: unknown) {
  const captured: Record<string, any> = {};
  const fake = {
    beta: {
      messages: {
        create: async (params: Record<string, unknown>) => {
          Object.assign(captured, params);
          if (error) throw error;
          return response;
        },
      },
    },
  };
  return { client: new AnthropicClient("claude-opus-5", "medium", fake as any), captured };
}

const message = (text: string, stop_reason = "end_turn") => ({ stop_reason, content: [{ type: "text", text }] });

describe("AnthropicClient", () => {
  it("parses JSON and sends the schema", async () => {
    const { client, captured } = clientReturning(message('{"ok": true}'));
    expect(await client.completeJson("sys", "user", { type: "object" })).toEqual({ ok: true });
    expect(captured.output_config).toEqual({ format: { type: "json_schema", schema: { type: "object" } }, effort: "medium" });
    expect(captured.system).toBe("sys");
    expect(captured.fallbacks).toBe("default");
  });

  it("turns refusals and truncation into errors", async () => {
    await expect(clientReturning(message("", "refusal")).client.completeJson("s", "u", {})).rejects.toThrow(/declined/);
    await expect(clientReturning(message("{", "max_tokens")).client.completeJson("s", "u", {})).rejects.toThrow(/cut off/);
  });

  it("explains missing credentials", async () => {
    const err = new Error("Could not resolve authentication method. Expected one of apiKey...");
    await expect(clientReturning(undefined, err).client.completeJson("s", "u", {})).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});
