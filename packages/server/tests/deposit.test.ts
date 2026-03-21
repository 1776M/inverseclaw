/**
 * Deposit hold API tests
 *
 * Tests the deposit-aware routes using a mocked Stripe client.
 * Existing non-deposit behaviour is verified to be unchanged.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Mock Stripe before any imports that use it
vi.mock('stripe', () => {
  return {
    default: class MockStripe {
      paymentIntents = {
        create: vi.fn().mockResolvedValue({
          id: 'pi_test_123',
          client_secret: 'pi_test_123_secret_abc',
        }),
        capture: vi.fn().mockResolvedValue({
          id: 'pi_test_123',
          status: 'succeeded',
        }),
        cancel: vi.fn().mockResolvedValue({
          id: 'pi_test_123',
          status: 'canceled',
        }),
      };
    },
  };
});

import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { registerDepositRoutes } from '../src/depositRoutes.js';
import { initStripe } from '../src/stripe.js';
import type { DepositConfig } from '../src/config.js';
import type { ExtendedService } from '../src/services.js';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdirSync, existsSync, rmSync } from 'node:fs';

const TEST_DB_DIR = join(process.cwd(), 'data-test-deposit');
const TEST_DB_PATH = join(TEST_DB_DIR, 'deposit.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

const TEST_CONFIG: DepositConfig = {
  nodeId: 'dep123',
  businessApiKey: 'ic_biz_deposit_test_key',
  businessName: 'Deposit Test Business',
  contactEmail: 'test@deposit.com',
  contactPhone: '+441234567890',
  presenceUrls: ['https://example.com'],
  autoPublish: false,
  port: 0,
  stripeSecretKey: 'sk_test_fake',
};

const TEST_SERVICES: ExtendedService[] = [
  {
    name: 'Oven Cleaning',
    description: 'Professional oven cleaning',
    service_area: { country: 'GB', regions: ['M', 'SK'] },
    deposit_required: true,
    deposit_amount_pence: 1500,
  },
  {
    name: 'Plumbing',
    description: 'Emergency plumbing services',
    deposit_required: false,
  },
];

let prisma: PrismaClient;
let app: ReturnType<typeof Fastify>;

beforeAll(async () => {
  if (!existsSync(TEST_DB_DIR)) {
    mkdirSync(TEST_DB_DIR, { recursive: true });
  }
  execSync('npx prisma db push --skip-generate', {
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    cwd: process.cwd(),
    stdio: 'ignore',
  });
  prisma = new PrismaClient({
    datasources: { db: { url: TEST_DB_URL } },
  });

  initStripe('sk_test_fake');

  app = Fastify();
  registerDepositRoutes(app, TEST_CONFIG, TEST_SERVICES, prisma);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  if (existsSync(TEST_DB_DIR)) {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  }
});

describe('POST /tasks (deposit-aware)', () => {
  it('should return pending_deposit and stripe_client_secret for deposit service', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Oven Cleaning',
        details: 'Double oven, M1 2AB',
        contact: { name: 'Jane', email: 'jane@test.com' },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('pending_deposit');
    expect(body.stripe_client_secret).toBe('pi_test_123_secret_abc');
    expect(body.deposit_amount_pence).toBe(1500);
    expect(body.task_id).toMatch(/^tsk_/);
    expect(body.transaction_id).toMatch(/^ic_dep123_/);
  });

  it('should return pending with no stripe fields for non-deposit service', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Plumbing',
        details: 'Leaky tap',
        contact: { name: 'Bob' },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('pending');
    expect(body.stripe_client_secret).toBeUndefined();
    expect(body.deposit_amount_pence).toBeUndefined();
  });

  it('should still reject unknown service', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Rocket Launch',
        details: 'To the moon',
        contact: { name: 'Elon' },
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('SERVICE_NOT_FOUND');
  });

  it('should still reject missing fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: { service_name: 'Oven Cleaning' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /tasks/:task_id/deposit (confirm deposit)', () => {
  let taskId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Oven Cleaning',
        details: 'Single oven',
        contact: { name: 'Alice' },
      },
    });
    taskId = res.json().task_id;
  });

  it('should confirm deposit and transition to pending', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit`,
      payload: { payment_intent_id: 'pi_test_123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().updated).toBe(true);
    expect(res.json().status).toBe('pending');
  });

  it('should show task as pending with deposit_status held', async () => {
    const res = await app.inject({ method: 'GET', url: `/tasks/${taskId}` });
    const body = res.json();
    expect(body.status).toBe('pending');
    expect(body.deposit_required).toBe(true);
    expect(body.deposit_amount_pence).toBe(1500);
    expect(body.deposit_status).toBe('held');
    expect(body.events).toHaveLength(2);
    expect(body.events[0].status).toBe('pending_deposit');
    expect(body.events[1].status).toBe('pending');
  });

  it('should reject confirm on task already past pending_deposit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit`,
      payload: { payment_intent_id: 'pi_test_123' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('INVALID_STATE');
  });
});

describe('POST /tasks/:task_id/deposit (wrong payment_intent_id)', () => {
  let taskId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Oven Cleaning',
        details: 'Range cooker',
        contact: { name: 'Charlie' },
      },
    });
    taskId = res.json().task_id;
  });

  it('should reject mismatched payment_intent_id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit`,
      payload: { payment_intent_id: 'pi_wrong_id' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_PAYMENT_INTENT');
  });
});

describe('Full deposit lifecycle', () => {
  let taskId: string;

  it('Step 1: Create task with deposit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Oven Cleaning',
        details: 'Double oven, M20 4BX',
        contact: { name: 'Dave', phone: '07700900000' },
      },
    });
    expect(res.statusCode).toBe(201);
    taskId = res.json().task_id;
    expect(res.json().status).toBe('pending_deposit');
  });

  it('Step 2: Confirm deposit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit`,
      payload: { payment_intent_id: 'pi_test_123' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('Step 3: Business accepts', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/events`,
      headers: { authorization: `Bearer ${TEST_CONFIG.businessApiKey}` },
      payload: { status: 'accepted', message: 'Booked for Tuesday' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('Step 4: Business starts work', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/events`,
      headers: { authorization: `Bearer ${TEST_CONFIG.businessApiKey}` },
      payload: { status: 'in_progress', message: 'On the way' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('Step 5: Business completes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/events`,
      headers: { authorization: `Bearer ${TEST_CONFIG.businessApiKey}` },
      payload: { status: 'completed', message: 'Job done' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('Step 6: Business releases deposit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit/release`,
      headers: { authorization: `Bearer ${TEST_CONFIG.businessApiKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().released).toBe(true);
  });

  it('Step 7: Full event history is correct', async () => {
    const res = await app.inject({ method: 'GET', url: `/tasks/${taskId}` });
    const body = res.json();
    expect(body.status).toBe('completed');
    expect(body.deposit_status).toBe('released');
    const statuses = body.events.map((e: any) => e.status);
    expect(statuses).toEqual([
      'pending_deposit',
      'pending',
      'accepted',
      'in_progress',
      'completed',
    ]);
  });
});

describe('Deposit capture (no-show)', () => {
  let taskId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Oven Cleaning',
        details: 'Single oven',
        contact: { name: 'Eve' },
      },
    });
    taskId = res.json().task_id;
    // Confirm deposit
    await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit`,
      payload: { payment_intent_id: 'pi_test_123' },
    });
  });

  it('should capture deposit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit/capture`,
      headers: { authorization: `Bearer ${TEST_CONFIG.businessApiKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().captured).toBe(true);
  });

  it('should show deposit_status as captured', async () => {
    const res = await app.inject({ method: 'GET', url: `/tasks/${taskId}` });
    expect(res.json().deposit_status).toBe('captured');
  });

  it('should reject double capture', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit/capture`,
      headers: { authorization: `Bearer ${TEST_CONFIG.businessApiKey}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('INVALID_DEPOSIT_STATE');
  });
});

describe('Deposit auth checks', () => {
  let taskId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Oven Cleaning',
        details: 'Test',
        contact: { name: 'Frank' },
      },
    });
    taskId = res.json().task_id;
    await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit`,
      payload: { payment_intent_id: 'pi_test_123' },
    });
  });

  it('capture should reject missing auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit/capture`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('capture should reject wrong API key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit/capture`,
      headers: { authorization: 'Bearer wrong_key' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('release should reject missing auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit/release`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('release should reject wrong API key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit/release`,
      headers: { authorization: 'Bearer wrong_key' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Non-deposit task via deposit routes', () => {
  let taskId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Plumbing',
        details: 'Leaky tap in kitchen',
        contact: { name: 'Grace', phone: '07700900111' },
      },
    });
    taskId = res.json().task_id;
  });

  it('should show deposit_required as false', async () => {
    const res = await app.inject({ method: 'GET', url: `/tasks/${taskId}` });
    const body = res.json();
    expect(body.deposit_required).toBe(false);
    expect(body.deposit_amount_pence).toBeNull();
    expect(body.deposit_status).toBeNull();
  });

  it('should reject deposit confirm on non-deposit task', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit`,
      payload: { payment_intent_id: 'pi_anything' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('INVALID_STATE');
  });

  it('should work through normal lifecycle without deposit', async () => {
    let res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/events`,
      headers: { authorization: `Bearer ${TEST_CONFIG.businessApiKey}` },
      payload: { status: 'accepted' },
    });
    expect(res.statusCode).toBe(200);

    res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/events`,
      headers: { authorization: `Bearer ${TEST_CONFIG.businessApiKey}` },
      payload: { status: 'in_progress' },
    });
    expect(res.statusCode).toBe(200);

    res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/events`,
      headers: { authorization: `Bearer ${TEST_CONFIG.businessApiKey}` },
      payload: { status: 'completed' },
    });
    expect(res.statusCode).toBe(200);

    res = await app.inject({ method: 'GET', url: `/tasks/${taskId}` });
    expect(res.json().status).toBe('completed');
  });
});

describe('GET /services (deposit-aware)', () => {
  it('should include deposit fields in service listing', async () => {
    const res = await app.inject({ method: 'GET', url: '/services' });
    const services = res.json();
    expect(services[0].deposit_required).toBe(true);
    expect(services[0].deposit_amount_pence).toBe(1500);
    expect(services[1].deposit_required).toBe(false);
    expect(services[1].deposit_amount_pence).toBeNull();
  });
});

describe('GET /.well-known/inverseclaw (deposit-aware)', () => {
  it('should include deposit fields in discovery manifest', async () => {
    const res = await app.inject({ method: 'GET', url: '/.well-known/inverseclaw' });
    const body = res.json();
    const ovenService = body.services.find((s: any) => s.name === 'Oven Cleaning');
    expect(ovenService.deposit_required).toBe(true);
    expect(ovenService.deposit_amount_pence).toBe(1500);
  });
});
