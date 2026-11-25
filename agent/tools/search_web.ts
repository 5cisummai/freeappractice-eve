import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import { callApp } from "../lib/app";

const webSearchSchema = z.object({
  objective: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .describe(
      "Specific public fact to verify; exclude private student information.",
    ),
  search_queries: z
    .array(z.string().trim().min(1).max(200))
    .min(1)
    .max(3)
    .describe(
      "One to three distinct focused keyword queries; prefer official source names.",
    ),
});

export default defineDynamic(() =>
  process.env.PARALLEL_API_KEY
    ? defineTool({
        description:
          "Search public sources for current external facts. Prefer primary sources. Cite results as [cite:sourceId]. Omit student names, grades, and other private data from every query.",
        inputSchema: webSearchSchema,
        async execute({ objective, search_queries }, ctx) {
          const { allowed } = await callApp("authorize_search", {}, ctx);
          if (!allowed)
            return {
              error:
                "Web search requires at least 0.25 Coach credits remaining.",
            };
          const { default: Parallel } = await import("parallel-web");
          try {
            const apiKey = process.env.PARALLEL_API_KEY;
            const client = new Parallel({
              apiKey,
              timeout: 15_000,
              maxRetries: 0,
            });
            const response = await client.search(
              {
                objective,
                search_queries,
                mode: "fast",
                client_model: "openai/gpt-6-luna",
                max_chars_total: 6_000,
                advanced_settings: {
                  max_results: 5,
                  excerpt_settings: { max_chars_per_result: 1200 },
                },
              },
              { signal: ctx.abortSignal },
            );
            if (!(await callApp("complete_search", {}, ctx)).ok)
              throw new Error("Search could not be recorded.");
            return {
              results: response.results.map((result, index) => ({
                sourceId: `${ctx.callId}-${index + 1}`,
                title: result.title ?? result.url,
                url: result.url,
                publishDate: result.publish_date ?? null,
                excerpts: result.excerpts,
              })),
              warnings:
                response.warnings?.map((warning) => warning.message) ?? [],
            };
          } catch {
            return { error: "Web search is temporarily unavailable." };
          }
        },
      })
    : null,
);
