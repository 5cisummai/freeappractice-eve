import { timingSafeEqual } from "node:crypto";
import { defineChannel, POST } from "eve/channels";
import { z } from "zod";

const text = z.string().max(24_000);
const completedToolSchema = z.enum([
  "ask_student",
  "give_practice_question",
  "update_goals",
  "update_study_plan",
]);
const turnSchema = z.strictObject({
  turnId: z.uuid(),
  deadline: z.number().int(),
  mode: z.enum(["quick", "thinking", "deep"]),
  context: text,
  completedTool: completedToolSchema.optional(),
  history: z
    .array(
      z.strictObject({
        id: z.string().max(200),
        role: z.enum(["user", "assistant"]),
        text,
      }),
    )
    .max(96),
  text: z.string().max(120_000),
  image: z
    .strictObject({
      mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      data: z
        .string()
        .max(7_000_000)
        .regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/),
    })
    .optional(),
});

function trusted(request: Request): boolean {
  const secret = process.env.COACH_EVE_SERVICE_SECRET;
  if (!secret || secret.length < 32) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

export default defineChannel<{
  turnId: string;
  mode: z.infer<typeof turnSchema>["mode"];
  completedTool: z.infer<typeof completedToolSchema> | null;
}>({
  state: { turnId: "", mode: "quick", completedTool: null },
  metadata: ({ turnId, mode, completedTool }) => ({
    turnId,
    mode,
    completedTool,
  }),
  audience: () => "private",
  routes: [
    POST(
      "/coach/v1/turn",
      async (request, { from, attachSession, waitUntil }) => {
        if (!trusted(request)) return new Response(null, { status: 401 });
        const parsed = turnSchema.safeParse(
          await request.json().catch(() => null),
        );
        if (!parsed.success) return new Response(null, { status: 400 });
        const turn = parsed.data;
        const remaining = turn.deadline - Date.now();
        if (remaining <= 0 || remaining > 60_000)
          return new Response(null, { status: 400 });

        const content = turn.image
          ? [
              { type: "text" as const, text: turn.text },
              { type: "file" as const, ...turn.image },
            ]
          : turn.text;
        const delivery = await from(turn.turnId).send(content, {
          auth: null,
          title: "Coach turn",
          idempotencyKey: turn.turnId,
          history: turn.history,
          context: [turn.context],
          state: {
            turnId: turn.turnId,
            mode: turn.mode,
            completedTool: turn.completedTool ?? null,
          },
        });
        const session = attachSession(delivery.sessionId);
        const signal = AbortSignal.any([
          request.signal,
          AbortSignal.timeout(remaining),
        ]);
        const iterator = delivery.stream({ signal })[Symbol.asyncIterator]();
        const encoder = new TextEncoder();
        const inspectionCalls = new Set<string>();
        let ending = false;
        function end() {
          if (ending) return;
          ending = true;
          waitUntil(
            session
              .end()
              .then(() => undefined)
              .catch(() => undefined),
          );
        }
        signal.addEventListener("abort", end, { once: true });
        if (signal.aborted) end();

        return new Response(
          new ReadableStream({
            async pull(controller) {
              try {
                while (true) {
                  const next = await iterator.next();
                  if (next.done) {
                    controller.close();
                    end();
                    return;
                  }
                  const event = next.value;
                  // Deliver only what the app needs to render, charge, and finalize the turn.
                  switch (event.type) {
                    case "content.delta":
                    case "content.completed":
                    case "usage.recorded":
                    case "delivery.settled":
                      controller.enqueue(
                        encoder.encode(JSON.stringify(event) + "\n"),
                      );
                      return;
                    case "call.requested":
                      if (
                        event.data.capability.name === "inspect_coach_image"
                      ) {
                        inspectionCalls.add(event.data.callId);
                      }
                      controller.enqueue(
                        encoder.encode(JSON.stringify(event) + "\n"),
                      );
                      return;
                    case "call.settled": {
                      if (inspectionCalls.delete(event.data.callId)) {
                        const { callId, outcome } = event.data;
                        const data = {
                          callId,
                          outcome,
                          output: { inspected: outcome === "completed" },
                        };
                        controller.enqueue(
                          encoder.encode(
                            JSON.stringify({ type: event.type, data }) + "\n",
                          ),
                        );
                      } else {
                        controller.enqueue(
                          encoder.encode(JSON.stringify(event) + "\n"),
                        );
                      }
                      return;
                    }
                  }
                }
              } catch (error) {
                controller.error(error);
                end();
              }
            },
            async cancel() {
              end();
              await iterator.return?.();
            },
          }),
          {
            headers: {
              "Content-Type": "application/x-ndjson",
              "Cache-Control": "no-store",
            },
          },
        );
      },
    ),
  ],
});
