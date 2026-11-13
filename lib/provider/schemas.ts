import { z } from "zod";

export const modelRawSchema = z.looseObject({
  id: z.string(),
  name: z.string().nullish(),
  capabilities: z.looseObject({ completion_chat: z.boolean().optional() }).optional(),
  context_window: z.number().optional(),
  context_length: z.number().optional(),
  max_output_tokens: z.number().optional(),
  effort: z.looseObject({ supported_levels: z.array(z.string()).optional() }).optional(),
  supported_parameters: z.array(z.string()).optional(),
});

export const modelListSchema = z.looseObject({ data: z.array(modelRawSchema) });

const contentChunkSchema = z.union([
  z.looseObject({ type: z.literal("text"), text: z.string() }).transform((chunk) => chunk.text),
  z.looseObject({ type: z.string().refine((type) => type !== "text") }).transform(() => ""),
]);

const contentSchema = z.union([
  z.string(),
  z.array(contentChunkSchema).transform((chunks) => chunks.join("")),
]);

export const chatSchema = z.looseObject({
  choices: z.array(
    z.looseObject({
      message: z.looseObject({ content: contentSchema.nullish() }),
      finish_reason: z.unknown().optional(),
    }),
  ),
});

export const errorBodySchema = z.looseObject({
  error: z.looseObject({ message: z.string().optional() }).optional(),
});
