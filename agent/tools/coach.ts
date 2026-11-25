import {
  defineDynamic,
  defineTool,
  toolOutput,
  toolOutputPart,
} from "eve/tools";
import { z } from "zod";
import { callApp } from "../lib/app";
import { courseSchema, studyPlanToolInputSchema } from "../lib/study-plan";

const unit = z.string().trim().min(1).max(200);
const empty = z.strictObject({});
const canvas = z.strictObject({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(8000),
});
const target = z.string().min(1).max(200).optional();
const emoji = z.enum(["❤️", "👍", "👎", "😂", "🎉"]);

function remote<T extends z.ZodType>(
  name: string,
  description: string,
  inputSchema: T,
) {
  return defineTool({
    description,
    inputSchema,
    execute: (input, ctx) => callApp(name, input, ctx),
  });
}

// Web Coach owns inline responses and approvals. End this Eve delivery after
// emitting the tool request so the app can continue with a fresh credential.
function inline<T extends z.ZodType>(description: string, inputSchema: T) {
  return defineTool({
    description,
    inputSchema,
    endsTurn: true,
    execute: async () => ({ pending: true }),
  });
}

export default defineDynamic(({ channel }) => {
  const tools = {
    read_current_question: remote(
      "read_current_question",
      "Load the redacted current question when attached to this chat.",
      empty,
    ),
    read_course_catalog: remote(
      "read_course_catalog",
      "List courses, list all units in one course, or resolve an exact unit.",
      z.strictObject({
        course: courseSchema.optional(),
        unit: unit.optional(),
      }),
    ),
    read_profile: remote(
      "read_profile",
      "Read selected AP courses, exam dates, and study availability.",
      empty,
    ),
    read_progress_summary: remote(
      "read_progress_summary",
      "Read the weakest tracked units with enough practice evidence.",
      empty,
    ),
    read_activity_summary: remote(
      "read_activity_summary",
      "Read activity, study time, streak, and recent practice totals.",
      empty,
    ),
    read_study_plan: remote(
      "read_study_plan",
      "Read the active study plan and completion status.",
      empty,
    ),
    read_unit_detail: remote(
      "read_unit_detail",
      "Read MCQ mastery and recent mistakes for one exact course and unit.",
      z.strictObject({ course: courseSchema, unit }),
    ),
    read_frq_performance: remote(
      "read_frq_performance",
      "Read recent graded FRQs, scores, and feedback.",
      z.strictObject({
        course: courseSchema.optional(),
        unit: unit.optional(),
        limit: z.number().int().min(1).max(6).optional(),
      }),
    ),
    read_quiz_attempt: remote(
      "read_quiz_attempt",
      "Read a completed quiz owned by this student. Omit positions to review incorrect questions.",
      z.strictObject({
        quizId: z.uuid(),
        questionPositions: z
          .array(z.number().int().min(1).max(50))
          .max(20)
          .optional(),
      }),
    ),
    update_goals: inline(
      "Ask the student to approve a requested change to courses, target dates, or availability.",
      z.strictObject({
        selectedApClasses: z.array(courseSchema).max(20).optional(),
        targetDates: z
          .array(
            z.strictObject({ course: courseSchema, targetDate: z.iso.date() }),
          )
          .max(20)
          .optional(),
        studyAvailability: z.string().trim().max(500).optional(),
      }),
    ),
    update_study_plan: inline(
      "Ask the student to approve a complete proposed study plan before writing it.",
      studyPlanToolInputSchema,
    ),
    ask_student: inline(
      "Ask a concise question when an essential detail is missing. Include choices only when useful; the student can also write an answer.",
      z.strictObject({
        question: z.string().trim().min(1).max(500),
        options: z
          .array(z.string().trim().min(1).max(120))
          .min(2)
          .max(5)
          .optional(),
      }),
    ),
    give_practice_question: inline(
      "Show one inline practice question for the student to answer or skip. Never reveal its answer.",
      z.strictObject({
        course: courseSchema,
        unit: unit.optional(),
        mode: z.enum(["mcq", "frq"]).default("mcq"),
      }),
    ),
    open_physics_sim: defineTool({
      description:
        "Open an interactive physics simulation. Give the app generator the learning goal, model, units, starting values, and controls.",
      inputSchema: canvas,
      execute: (input, ctx) => callApp("open_physics_sim", input, ctx),
      toModelOutput: (output) => ({
        type: "text",
        value: output.error ?? `Opened physics simulation: ${output.title}`,
      }),
    }),
    open_math_explorer: defineTool({
      description:
        "Open an interactive math explorer. Give the app generator the learning goal, model, variables, ranges, and controls.",
      inputSchema: canvas,
      execute: (input, ctx) => callApp("open_math_explorer", input, ctx),
      toModelOutput: (output) => ({
        type: "text",
        value: output.error ?? `Opened math explorer: ${output.title}`,
      }),
    }),
    inspect_coach_image: defineTool({
      description:
        "Inspect an image previously uploaded in this conversation using its saved ID.",
      inputSchema: z.strictObject({ imageId: z.uuid() }),
      execute: (input, ctx) => callApp("inspect_coach_image", input, ctx),
      toModelOutput: (output) =>
        output.data
          ? toolOutput.content([
              toolOutputPart.file(output.data, { mediaType: "image/webp" }),
            ])
          : { type: "text", value: "Image unavailable." },
    }),
    report_progress: defineTool({
      description: "Send a short status bubble before substantial work or when a meaningful milestone changes what happens next. Continue working afterward.",
      inputSchema: z.strictObject({ message: z.string().trim().min(1).max(240) }),
      execute: async ({ message }) => ({ message }),
    }),
    send_message: defineTool({
      description: "Send a complete answer bubble now, then continue with the next part. Use only when a longer answer has a natural break.",
      inputSchema: z.strictObject({ message: z.string().trim().min(1).max(1800) }),
      execute: async ({ message }) => ({ message }),
    }),
    reply_to_message: defineTool({
      description:
        "Quote a student message and reply. Omit messageId for the latest student message. This tool sends the whole reply.",
      inputSchema: z.strictObject({
        messageId: target,
        message: z.string().trim().min(1).max(8000),
      }),
      execute: async ({ messageId, message }, ctx) => {
        const result = await callApp("resolve_chat_target", { messageId }, ctx);
        return result.targetId
          ? { targetId: result.targetId, message }
          : { error: "Student message unavailable." };
      },
      endsTurn: (output) => "targetId" in output,
    }),
    react_to_message: defineTool({
      description:
        "React to a student message. Omit messageId for the latest one. Set reactionOnly when the reaction is the whole reply.",
      inputSchema: z.strictObject({
        messageId: target,
        emoji,
        reactionOnly: z.boolean().optional(),
      }),
      execute: async ({ messageId, emoji, reactionOnly }, ctx) => {
        const result = await callApp("resolve_chat_target", { messageId }, ctx);
        return result.targetId
          ? {
              targetId: result.targetId,
              emoji,
              reactionOnly: reactionOnly === true,
            }
          : { error: "Student message unavailable." };
      },
      endsTurn: (output) =>
        "reactionOnly" in output && output.reactionOnly === true,
    }),
  };
  const completed = channel.metadata.completedTool;
  return Object.fromEntries(
    Object.entries(tools).filter(([name]) => name !== completed),
  );
});
