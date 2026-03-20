import { z } from 'zod';

export const TaskStatus = z.enum([
  'pending',
  'accepted',
  'in_progress',
  'completed',
  'declined',
  'cancelled',
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const CreateTaskBody = z.object({
  service_name: z.string().min(1),
  details: z.string().min(1),
  contact: z.object({
    name: z.string().min(1),
    phone: z.string().optional(),
    email: z.string().email().optional(),
  }),
});
export type CreateTaskBody = z.infer<typeof CreateTaskBody>;

export const PushEventBody = z.object({
  status: TaskStatus.exclude(['pending']),
  message: z.string().optional(),
});
export type PushEventBody = z.infer<typeof PushEventBody>;

// Valid state transitions: from → allowed next states
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['accepted', 'declined', 'cancelled'],
  accepted: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
};

export function isValidTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}
