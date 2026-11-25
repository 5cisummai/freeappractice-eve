import { defineAgent, defineDynamic } from "eve";

export default defineAgent({
  model: defineDynamic(({ channel }) => ({
    model: "openai/gpt-6-luna",
    reasoning:
      channel.metadata?.mode === "deep"
        ? "high"
        : channel.metadata?.mode === "thinking"
          ? "medium"
          : "low",
  })),
  defaultTools: false,
  experimental: { workflow: { retention: 0 } },
  limits: { sessionTimeoutMs: 60_000 },
});
