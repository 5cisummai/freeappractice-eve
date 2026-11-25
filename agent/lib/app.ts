import { isChannel } from "eve/channels";
import type { ToolContext } from "eve/tools";
import coach from "../channels/coach";

export async function callApp(name: string, input: unknown, ctx: ToolContext) {
  const origin = process.env.COACH_APP_URL;
  const secret = process.env.COACH_EVE_SERVICE_SECRET;
  if (!origin || !secret || !isChannel(ctx.channel, coach)) {
    throw new Error("Coach app tools are unavailable.");
  }
  const { turnId } = ctx.channel.metadata;
  if (!turnId) {
    throw new Error("Coach app tools are unavailable.");
  }
  const response = await fetch(new URL(`/api/coach-tools/v1/${name}`, origin), {
    method: "POST",
    redirect: "error",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      ...(process.env.COACH_APP_VERCEL_BYPASS
        ? { "x-vercel-protection-bypass": process.env.COACH_APP_VERCEL_BYPASS }
        : {}),
    },
    body: JSON.stringify({
      turnId,
      callId: ctx.callId,
      input: input ?? {},
    }),
    signal: ctx.abortSignal,
  });
  if (!response.ok)
    throw new Error("The Coach app could not complete that tool call.");
  return response.json();
}
