import { z } from "zod"

export const lockStatusSchema = z.object({
  locked: z.boolean(),
  updatedAt: z.string().datetime(),
})
export type LockStatus = z.infer<typeof lockStatusSchema>
