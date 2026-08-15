import { z } from 'zod'

export const hydraValueSchema = z.union([
  z.object({ type: z.literal('null'), value: z.null().optional() }),
  z.object({ type: z.literal('vertex_id'), value: z.number() }),
  z.object({ type: z.literal('integer'), value: z.number() }),
  z.object({ type: z.literal('signed_integer'), value: z.number() }),
  z.object({ type: z.literal('float'), value: z.number() }),
  z.object({ type: z.literal('boolean'), value: z.boolean() }),
  z.object({ type: z.literal('string'), value: z.string() }),
  z.object({ type: z.literal('list'), value: z.array(z.unknown()) }),
  z.object({ type: z.literal('path'), value: z.unknown() }),
])

export type HydraValue = z.infer<typeof hydraValueSchema>

export const queryResponseSchema = z.object({
  query_id: z.string(),
  columns: z.array(z.string()),
  rows: z.array(z.array(hydraValueSchema)),
  read_epoch: z.number().nullable(),
  next_cursor: z.number().nullable(),
  bookmark: z.string().nullable(),
})

export type QueryResponse = z.infer<typeof queryResponseSchema>

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    owner: z.string().optional(),
  }),
})

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>
