import { z } from "zod";

export const manualTaskTitleSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine(
      (title) => !/[\u0000-\u001f\u007f]/.test(title),
      "Use a single-line title without control characters",
    ),
});
