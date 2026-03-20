import { describe, it, expect } from 'vitest';
import { CreateTaskBody, PushEventBody, isValidTransition } from '../src/schemas.js';

describe('CreateTaskBody validation', () => {
  it('should accept valid input', () => {
    const result = CreateTaskBody.safeParse({
      service_name: 'Oven Cleaning',
      details: 'Double oven, M1 2AB',
      contact: { name: 'Jane Smith', email: 'jane@test.com' },
    });
    expect(result.success).toBe(true);
  });

  it('should accept contact with phone only', () => {
    const result = CreateTaskBody.safeParse({
      service_name: 'Oven Cleaning',
      details: 'Double oven',
      contact: { name: 'Jane', phone: '07700900123' },
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing service_name', () => {
    const result = CreateTaskBody.safeParse({
      details: 'Double oven',
      contact: { name: 'Jane' },
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing details', () => {
    const result = CreateTaskBody.safeParse({
      service_name: 'Oven Cleaning',
      contact: { name: 'Jane' },
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing contact name', () => {
    const result = CreateTaskBody.safeParse({
      service_name: 'Oven Cleaning',
      details: 'Double oven',
      contact: { email: 'jane@test.com' },
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid email', () => {
    const result = CreateTaskBody.safeParse({
      service_name: 'Oven Cleaning',
      details: 'Double oven',
      contact: { name: 'Jane', email: 'not-an-email' },
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty service_name', () => {
    const result = CreateTaskBody.safeParse({
      service_name: '',
      details: 'Double oven',
      contact: { name: 'Jane' },
    });
    expect(result.success).toBe(false);
  });
});

describe('PushEventBody validation', () => {
  it('should accept valid status', () => {
    const result = PushEventBody.safeParse({ status: 'accepted' });
    expect(result.success).toBe(true);
  });

  it('should accept status with message', () => {
    const result = PushEventBody.safeParse({
      status: 'accepted',
      message: 'Booked for next Tuesday',
    });
    expect(result.success).toBe(true);
  });

  it('should reject "pending" as a push status', () => {
    const result = PushEventBody.safeParse({ status: 'pending' });
    expect(result.success).toBe(false);
  });

  it('should reject invalid status', () => {
    const result = PushEventBody.safeParse({ status: 'banana' });
    expect(result.success).toBe(false);
  });

  it('should accept all valid non-pending statuses', () => {
    for (const status of ['accepted', 'in_progress', 'completed', 'declined', 'cancelled']) {
      const result = PushEventBody.safeParse({ status });
      expect(result.success).toBe(true);
    }
  });
});

describe('isValidTransition', () => {
  it('should allow pending → accepted', () => {
    expect(isValidTransition('pending', 'accepted')).toBe(true);
  });

  it('should allow pending → declined', () => {
    expect(isValidTransition('pending', 'declined')).toBe(true);
  });

  it('should allow pending → cancelled', () => {
    expect(isValidTransition('pending', 'cancelled')).toBe(true);
  });

  it('should allow accepted → in_progress', () => {
    expect(isValidTransition('accepted', 'in_progress')).toBe(true);
  });

  it('should allow accepted → cancelled', () => {
    expect(isValidTransition('accepted', 'cancelled')).toBe(true);
  });

  it('should allow in_progress → completed', () => {
    expect(isValidTransition('in_progress', 'completed')).toBe(true);
  });

  it('should allow in_progress → cancelled', () => {
    expect(isValidTransition('in_progress', 'cancelled')).toBe(true);
  });

  it('should reject completed → anything', () => {
    expect(isValidTransition('completed', 'pending')).toBe(false);
    expect(isValidTransition('completed', 'cancelled')).toBe(false);
  });

  it('should reject pending → in_progress (must accept first)', () => {
    expect(isValidTransition('pending', 'in_progress')).toBe(false);
  });

  it('should reject pending → completed (must accept first)', () => {
    expect(isValidTransition('pending', 'completed')).toBe(false);
  });

  it('should reject backwards transitions', () => {
    expect(isValidTransition('in_progress', 'accepted')).toBe(false);
    expect(isValidTransition('accepted', 'pending')).toBe(false);
  });
});
