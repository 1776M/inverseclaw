import { randomBytes } from 'node:crypto';

function randomAlphanumeric(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

export function generateTransactionId(nodeId: string): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');
  const random = randomAlphanumeric(5);
  return `ic_${nodeId}_${timestamp}_${random}`;
}

export function generateTaskId(): string {
  return `tsk_${randomAlphanumeric(12)}`;
}
