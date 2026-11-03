import { z } from "zod";

export const infoSchema = z.looseObject({ version: z.string() });

export const modelRawSchema = z.looseObject({
  providerID: z.string(),
  id: z.string(),
  name: z.string(),
  variants: z.array(z.looseObject({ id: z.string() })).default([]),
  limit: z.looseObject({ context: z.number(), output: z.number() }).optional(),
  enabled: z.boolean().optional(),
});

export const modelListSchema = z.looseObject({ data: z.array(modelRawSchema) });

export const defaultModelSchema = z.looseObject({ data: modelRawSchema.nullable() });

export const generateSchema = z.looseObject({ data: z.looseObject({ text: z.string() }) });

export const connectSchema = z.looseObject({ token: z.string().min(1) });

export const errorBodySchema = z.looseObject({
  _tag: z.string().optional(),
  reason: z.string().optional(),
  message: z.string().optional(),
  retryAfterMs: z.number().nullish(),
});
