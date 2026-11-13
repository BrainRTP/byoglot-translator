import { z } from "zod";

export const modelRawSchema = z.looseObject({
  id: z.string(),
  name: z.string().optional(),
  context_window: z.number().optional(),
  context_length: z.number().optional(),
  max_output_tokens: z.number().optional(),
  effort: z.looseObject({ supported_levels: z.array(z.string()).optional() }).optional(),
  supported_parameters: z.array(z.string()).optional(),
});

export const modelListSchema = z.looseObject({ data: z.array(modelRawSchema) });

export const chatSchema = z.looseObject({
  choices: z.array(
    z.looseObject({
      message: z.looseObject({ content: z.string().nullish() }),
      finish_reason: z.unknown().optional(),
    }),
  ),
});

export const errorBodySchema = z.looseObject({
  error: z.looseObject({ message: z.string().optional() }).optional(),
});
