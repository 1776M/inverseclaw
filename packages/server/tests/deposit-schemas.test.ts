import { describe, it, expect } from 'vitest';
import {
  ConfirmDepositBody,
  TaskStatusWithDeposit,
  isValidDepositTransition,
  isValidTransition,
} from '../src/schemas.js';

describe('ConfirmDepositBody (provider-agnostic)', () => {
  it('should accept Stripe confirmation', () => {
    const result = ConfirmDepositBody.safeParse({
      provider: 'stripe',
      payment_intent_id: 'pi_abc123',
    });
    expect(result.success).toBe(true);
  });

  it('should accept USDC confirmation', () => {
    const result = ConfirmDepositBody.safeParse({
      provider: 'usdc_base',
      tx_hash: '0xabcdef',
    });
    expect(result.success).toBe(true);
  });

  it('should accept any provider with extra fields', () => {
    const result = ConfirmDepositBody.safeParse({
      provider: 'future_provider',
      some_field: 'value',
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing provider', () => {
    const result = ConfirmDepositBody.safeParse({
      payment_intent_id: 'pi_abc',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty provider', () => {
    const result = ConfirmDepositBody.safeParse({ provider: '' });
    expect(result.success).toBe(false);
  });
});

describe('TaskStatusWithDeposit', () => {
  it('should accept pending_deposit', () => {
    expect(TaskStatusWithDeposit.safeParse('pending_deposit').success).toBe(true);
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

  it('should reject pending_deposit → accepted', () => {
    expect(isValidDepositTransition('pending_deposit', 'accepted')).toBe(false);
  });

  it('should allow all existing transitions', () => {
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

  it('should reject terminal state transitions', () => {
    expect(isValidDepositTransition('completed', 'pending')).toBe(false);
    expect(isValidDepositTransition('declined', 'accepted')).toBe(false);
  });
});
