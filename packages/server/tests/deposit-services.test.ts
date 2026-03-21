import { describe, it, expect } from 'vitest';
import { ExtendedServiceSchema, loadServicesWithDeposit } from '../src/services.js';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

describe('ExtendedServiceSchema', () => {
  it('should accept service with deposit fields', () => {
    const result = ExtendedServiceSchema.safeParse({
      name: 'Oven Cleaning',
      description: 'Professional oven cleaning',
      deposit_required: true,
      deposit_amount_pence: 1500,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deposit_required).toBe(true);
      expect(result.data.deposit_amount_pence).toBe(1500);
    }
  });

  it('should accept service without deposit fields (backward compatible)', () => {
    const result = ExtendedServiceSchema.safeParse({
      name: 'Plumbing',
      description: 'Emergency plumbing',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deposit_required).toBe(false);
      expect(result.data.deposit_amount_pence).toBeUndefined();
    }
  });

  it('should accept service with deposit_required: false and no amount', () => {
    const result = ExtendedServiceSchema.safeParse({
      name: 'Gardening',
      description: 'Garden maintenance',
      deposit_required: false,
    });
    expect(result.success).toBe(true);
  });

  it('should reject deposit_required: true without deposit_amount_pence', () => {
    const result = ExtendedServiceSchema.safeParse({
      name: 'Cleaning',
      description: 'Cleaning service',
      deposit_required: true,
    });
    expect(result.success).toBe(false);
  });

  it('should reject negative deposit_amount_pence', () => {
    const result = ExtendedServiceSchema.safeParse({
      name: 'Cleaning',
      description: 'Cleaning service',
      deposit_required: true,
      deposit_amount_pence: -500,
    });
    expect(result.success).toBe(false);
  });

  it('should reject zero deposit_amount_pence', () => {
    const result = ExtendedServiceSchema.safeParse({
      name: 'Cleaning',
      description: 'Cleaning service',
      deposit_required: true,
      deposit_amount_pence: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should accept service with service_area and deposit fields', () => {
    const result = ExtendedServiceSchema.safeParse({
      name: 'Oven Cleaning',
      description: 'Professional cleaning',
      service_area: { country: 'GB', regions: ['M'] },
      deposit_required: true,
      deposit_amount_pence: 2000,
    });
    expect(result.success).toBe(true);
  });
});

describe('loadServicesWithDeposit', () => {
  const tmpDir = join(process.cwd(), 'data-test-deposit-services');

  function writeTmpYaml(content: string): string {
    if (!existsSync(tmpDir)) {
      mkdirSync(tmpDir, { recursive: true });
    }
    const filePath = join(tmpDir, 'services.yaml');
    writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  afterAll(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should load services with deposit fields', () => {
    const path = writeTmpYaml(`
services:
  - name: Oven Cleaning
    description: Professional cleaning
    deposit_required: true
    deposit_amount_pence: 1500
  - name: Plumbing
    description: Emergency plumbing
`);
    const services = loadServicesWithDeposit(path);
    expect(services).toHaveLength(2);
    expect(services[0].deposit_required).toBe(true);
    expect(services[0].deposit_amount_pence).toBe(1500);
    expect(services[1].deposit_required).toBe(false);
    expect(services[1].deposit_amount_pence).toBeUndefined();
  });

  it('should load services without any deposit fields (backward compat)', () => {
    const path = writeTmpYaml(`
services:
  - name: Gardening
    description: Garden work
`);
    const services = loadServicesWithDeposit(path);
    expect(services).toHaveLength(1);
    expect(services[0].deposit_required).toBe(false);
  });
});
