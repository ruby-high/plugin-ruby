import { describe, expect, it } from "vitest";
import { buildZerollamaChatBody, resolveZerollamaApiBase } from "./zerollama-client.js";

describe("zerollama-client", () => {
  it("resolves API base from ZEROLLAMA_API_ENDPOINT", () => {
    const prev = process.env.ZEROLLAMA_API_ENDPOINT;
    process.env.ZEROLLAMA_API_ENDPOINT = "http://example:8080/";
    expect(resolveZerollamaApiBase()).toBe("http://example:8080");
    if (prev === undefined) delete process.env.ZEROLLAMA_API_ENDPOINT;
    else process.env.ZEROLLAMA_API_ENDPOINT = prev;
  });

  it("builds an Ollama-compatible chat body", async () => {
    const body = await buildZerollamaChatBody({
      model: "eliza-1:9b",
      prompt: "hello",
      qosClass: "background",
      projectName: "test",
    });
    expect(body.model).toBe("eliza-1:9b");
    expect(body.stream).toBe(false);
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.options).toBeTruthy();
  });
});
