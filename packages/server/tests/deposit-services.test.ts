import { describe, it, expect, afterAll } from 'vitest';
import { ExtendedServiceSchema, loadServicesWithDeposit } from '../src/services.js';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

describe('ExtendedServiceSchema (provider-agnostic)', () => {
  it('should accept service with deposit config', () => {
    const result = ExtendedServiceSchema.safeParse({
      name: 'Oven Cleaning',
      description: 'Professional oven cleaning',
      deposit: { amount_pence: 1500, providers: ['stripe'] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deposit?.amount_pence).toBe(1500);
      expect(result.data.deposit?.providers).toEqual(['stripe']);
    }
  });

  it('should accept multi-provider deposit', () => {
    const result = ExtendedServiceSchema.safeParse({
      name: 'Plumbing',
      description: 'Emergency plumbing',
      deposit: { amount_pence: 3000, providers: ['stripe', 'usdc_base'] },
    });
    expect(result.success).toBe(true);
  });

  it('should accept service without deposit (backward compat)', () => {
    const result = ExtendedServiceSchema.safeParse({
      name: 'Gardening',
      description: 'Garden maintenance',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deposit).toBeUndefined();
    }
  });

  it('should reject deposit with empty providers array', () => {
    const result = ExtendedServiceSchema.safeParse({
      name: 'Cleaning',
      description: 'Cleaning service',
      deposit: { amount_pence: 1000, providers: [] },
    });
    expect(result.success).toBe(false);
  });

  it('should reject deposit without amount_pence', () => {
    const result = ExtendedServiceSchema.safeParse({
      name: 'Cleaning',
      description: 'Cleaning service',
      deposit: { providers: ['stripe'] },
    });
    expect(result.success).toBe(false);
  });

  it('should reject negative deposit amount', () => {
    const result = ExtendedServiceSchema.safeParse({
      name: 'Cleaning',
      description: 'Cleaning service',
      deposit: { amount_pence: -500, providers: ['stripe'] },
    });
    expect(result.success).toBe(false);
  });

  it('should accept service with service_area and deposit', () => {
    const result = ExtendedServiceSchema.safeParse({
      name: 'Oven Cleaning',
      description: 'Professional cleaning',
      service_area: { country: 'GB', regions: ['M'] },
      deposit: { amount_pence: 2000, providers: ['usdc_base'] },
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

  it('should load services with provider-agnostic deposit config', () => {
    const path = writeTmpYaml(`
services:
  - name: Oven Cleaning
    description: Professional cleaning
    deposit:
      amount_pence: 1500
      providers: [stripe, usdc_base]
  - name: Plumbing
    description: Emergency plumbing
`);
    const services = loadServicesWithDeposit(path);
    expect(services).toHaveLength(2);
    expect(services[0].deposit?.amount_pence).toBe(1500);
    expect(services[0].deposit?.providers).toEqual(['stripe', 'usdc_base']);
    expect(services[1].deposit).toBeUndefined();
  });

  it('should load services without any deposit config', () => {
    const path = writeTmpYaml(`
services:
  - name: Gardening
    description: Garden work
`);
    const services = loadServicesWithDeposit(path);
    expect(services).toHaveLength(1);
    expect(services[0].deposit).toBeUndefined();
  });
});
