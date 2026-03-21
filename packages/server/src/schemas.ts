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

export const ResearchBody = z.object({
  urls_checked: z.array(z.string().url()).min(1, 'Must check at least one presence URL'),
  summary: z.string().min(1, 'Research summary is required'),
});
export type ResearchBody = z.infer<typeof ResearchBody>;

export const CreateTaskBody = z.object({
  service_name: z.string().min(1),
  details: z.string().min(1),
  contact: z.object({
    name: z.string().min(1),
    phone: z.string().optional(),
    email: z.string().email().optional(),
  }),
  research: ResearchBody.optional(),
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

// --- Deposit hold extensions (v1.1) ---

export const TaskStatusWithDeposit = z.enum([
  'pending_deposit',
  'pending',
  'accepted',
  'in_progress',
  'completed',
  'declined',
  'cancelled',
]);
export type TaskStatusWithDeposit = z.infer<typeof TaskStatusWithDeposit>;

export const ConfirmDepositBody = z.object({
  provider: z.string().min(1),
}).passthrough();
export type ConfirmDepositBody = z.infer<typeof ConfirmDepositBody>;

const DEPOSIT_TRANSITIONS: Record<string, string[]> = {
  pending_deposit: ['pending', 'cancelled'],
};

export function isValidDepositTransition(from: string, to: string): boolean {
  const depositAllowed = DEPOSIT_TRANSITIONS[from];
  if (depositAllowed) return depositAllowed.includes(to);
  return isValidTransition(from, to);
}
