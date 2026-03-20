import { describe, it, expect } from 'vitest';
import { generateTransactionId, generateTaskId } from '../src/transaction.js';

describe('generateTransactionId', () => {
  it('should start with ic_ prefix', () => {
    const id = generateTransactionId('a3f9b2');
    expect(id.startsWith('ic_')).toBe(true);
  });

  it('should contain the node_id', () => {
    const id = generateTransactionId('a3f9b2');
    expect(id.split('_')[1]).toBe('a3f9b2');
  });

  it('should contain a timestamp segment', () => {
    const id = generateTransactionId('a3f9b2');
    const parts = id.split('_');
    // Timestamp is the third part: YYYYMMDDTHHmmss
    expect(parts[2]).toMatch(/^\d{8}T\d{6}$/);
  });

  it('should end with 5 random alphanumeric chars', () => {
    const id = generateTransactionId('a3f9b2');
    const parts = id.split('_');
    const random = parts[3];
    expect(random).toMatch(/^[a-z0-9]{5}$/);
  });

  it('should generate unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTransactionId('a3f9b2')));
    expect(ids.size).toBe(100);
  });
});

describe('generateTaskId', () => {
  it('should start with tsk_ prefix', () => {
    const id = generateTaskId();
    expect(id.startsWith('tsk_')).toBe(true);
  });

  it('should have 12 random chars after prefix', () => {
    const id = generateTaskId();
    const random = id.slice(4);
    expect(random).toMatch(/^[a-z0-9]{12}$/);
  });

  it('should generate unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTaskId()));
    expect(ids.size).toBe(100);
  });
});
