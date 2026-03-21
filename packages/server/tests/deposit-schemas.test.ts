import { describe, it, expect } from 'vitest';
import {
  ConfirmDepositBody,
  TaskStatusWithDeposit,
  isValidDepositTransition,
  isValidTransition,
} from '../src/schemas.js';

describe('ConfirmDepositBody', () => {
  it('should accept valid payment_intent_id', () => {
    const result = ConfirmDepositBody.safeParse({ payment_intent_id: 'pi_abc123' });
    expect(result.success).toBe(true);
  });

  it('should reject empty payment_intent_id', () => {
    const result = ConfirmDepositBody.safeParse({ payment_intent_id: '' });
    expect(result.success).toBe(false);
  });

  it('should reject missing payment_intent_id', () => {
    const result = ConfirmDepositBody.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('TaskStatusWithDeposit', () => {
  it('should accept pending_deposit', () => {
    const result = TaskStatusWithDeposit.safeParse('pending_deposit');
    expect(result.success).toBe(true);
  });

  it('should accept all original statuses', () => {
    for (const status of ['pending', 'accepted', 'in_progress', 'completed', 'declined', 'cancelled']) {
      expect(TaskStatusWithDeposit.safeParse(status).success).toBe(true);
    }
  });

  it('should reject invalid status', () => {
    expect(TaskStatusWithDeposit.safeParse('bogus').success).toBe(false);
  });
});

describe('isValidDepositTransition', () => {
  it('should allow pending_deposit → pending', () => {
    expect(isValidDepositTransition('pending_deposit', 'pending')).toBe(true);
  });

  it('should reject pending_deposit → accepted (must go through pending)', () => {
    expect(isValidDepositTransition('pending_deposit', 'accepted')).toBe(false);
  });

  it('should reject pending_deposit → completed', () => {
    expect(isValidDepositTransition('pending_deposit', 'completed')).toBe(false);
  });

  // All existing transitions still work via the fallback
  it('should allow pending → accepted', () => {
    expect(isValidDepositTransition('pending', 'accepted')).toBe(true);
  });

  it('should allow pending → declined', () => {
    expect(isValidDepositTransition('pending', 'declined')).toBe(true);
  });

  it('should allow accepted → in_progress', () => {
    expect(isValidDepositTransition('accepted', 'in_progress')).toBe(true);
  });

  it('should allow in_progress → completed', () => {
    expect(isValidDepositTransition('in_progress', 'completed')).toBe(true);
  });

  it('should reject accepted → completed (skip)', () => {
    expect(isValidDepositTransition('accepted', 'completed')).toBe(false);
  });

  it('should reject completed → anything (terminal)', () => {
    expect(isValidDepositTransition('completed', 'pending')).toBe(false);
    expect(isValidDepositTransition('completed', 'cancelled')).toBe(false);
  });

  // Verify original function is unchanged
  it('should be consistent with isValidTransition for non-deposit states', () => {
    const pairs: [string, string][] = [
      ['pending', 'accepted'],
      ['pending', 'declined'],
      ['pending', 'cancelled'],
      ['accepted', 'in_progress'],
      ['accepted', 'cancelled'],
      ['in_progress', 'completed'],
      ['in_progress', 'cancelled'],
    ];
    for (const [from, to] of pairs) {
      expect(isValidDepositTransition(from, to)).toBe(isValidTransition(from, to));
    }
  });
});
