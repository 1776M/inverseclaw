/**
 * Deposit hold API tests (provider-agnostic)
 *
 * Tests the deposit-aware routes using mocked Stripe and USDC providers.
 * Verifies multi-provider support and backward compatibility.
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
        retrieve: vi.fn().mockResolvedValue({
          id: 'pi_test_123',
          status: 'requires_capture',
        }),
        capture: vi.fn().mockResolvedValue({ id: 'pi_test_123', status: 'succeeded' }),
        cancel: vi.fn().mockResolvedValue({ id: 'pi_test_123', status: 'canceled' }),
      };
    },
  };
});

// Mock viem to avoid real RPC calls
vi.mock('viem', () => {
  return {
    createPublicClient: vi.fn().mockReturnValue({
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: 'success',
        logs: [
          {
            address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x000000000000000000000000sender0000000000000000000000000000000000',
              '0x000000000000000000000000abc123wallet00000000000000000000000000000',
            ],
            data: '0x0000000000000000000000000000000000000000000000000000000001312d00', // 20_000_000 = 20 USDC
          },
        ],
      }),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        status: 'success',
        logs: [
          {
            address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x000000000000000000000000sender0000000000000000000000000000000000',
              '0x000000000000000000000000abc123wallet00000000000000000000000000000',
            ],
            data: '0x0000000000000000000000000000000000000000000000000000000001312d00', // 20_000_000 = 20 USDC
          },
        ],
      }),
    }),
    createWalletClient: vi.fn().mockReturnValue({
      writeContract: vi.fn().mockResolvedValue('0xmocktxhash'),
    }),
    http: vi.fn(),
    parseAbiItem: vi.fn(),
    keccak256: vi.fn().mockReturnValue('0xmockhash'),
    toHex: vi.fn().mockImplementation((v: string) => `0x${Buffer.from(v).toString('hex')}`),
    encodeFunctionData: vi.fn().mockReturnValue('0x'),
  };
});

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn().mockReturnValue({
    address: '0xmockaccount',
    signTransaction: vi.fn(),
  }),
}));

vi.mock('viem/chains', () => ({
  base: { id: 8453, name: 'Base' },
  mainnet: { id: 1, name: 'Ethereum' },
  arbitrum: { id: 42161, name: 'Arbitrum One' },
  optimism: { id: 10, name: 'OP Mainnet' },
  polygon: { id: 137, name: 'Polygon' },
}));

import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { registerDepositRoutes } from '../src/depositRoutes.js';
import { registerProvider, clearProviders } from '../src/depositProvider.js';
import { StripeDepositProvider } from '../src/providers/stripe.js';
import { UsdcBaseDepositProvider } from '../src/providers/usdc.js';
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
  usdcWalletAddress: '0xabc123wallet00000000000000000000000000000',
};

const TEST_SERVICES: ExtendedService[] = [
  {
    name: 'Oven Cleaning',
    description: 'Professional oven cleaning',
    service_area: { country: 'GB', regions: ['M', 'SK'] },
    deposit: {
      amount_cents: 1500,
      providers: ['stripe', 'usdc_base'],
    },
  },
  {
    name: 'Plumbing',
    description: 'Emergency plumbing services',
  },
];

const R = {
  urls_checked: ['https://example.com'],
  summary: 'Verified on example.com',
};

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

  clearProviders();
  registerProvider(new StripeDepositProvider('sk_test_fake'));
  registerProvider(new UsdcBaseDepositProvider('0xabc123wallet00000000000000000000000000000'));

  app = Fastify();
  registerDepositRoutes(app, TEST_CONFIG, TEST_SERVICES, prisma);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  clearProviders();
  if (existsSync(TEST_DB_DIR)) {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  }
});

describe('POST /tasks (multi-provider deposit)', () => {
  it('should return pending_deposit with all provider options', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Oven Cleaning',
        details: 'Double oven, M1 2AB',
        contact: { name: 'Jane', email: 'jane@test.com' }, research: R,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('pending_deposit');
    expect(body.deposit_amount_cents).toBe(1500);

    // Should have both providers
    expect(body.deposit_providers).toBeDefined();
    expect(body.deposit_providers.stripe).toBeDefined();
    expect(body.deposit_providers.stripe.client_secret).toBe('pi_test_123_secret_abc');
    expect(body.deposit_providers.usdc_base).toBeDefined();
    expect(body.deposit_providers.usdc_base.wallet_address).toBe(
      '0xabc123wallet00000000000000000000000000000'
    );
    expect(body.deposit_providers.usdc_base.chain_id).toBe(8453);
    expect(body.deposit_providers.usdc_base.amount).toBeDefined();
    expect(body.deposit_providers.usdc_base.token).toBe('usdc');
  });

  it('should return pending with no deposit for non-deposit service', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Plumbing',
        details: 'Leaky tap',
        contact: { name: 'Bob' }, research: R,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('pending');
    expect(body.deposit_providers).toBeUndefined();
  });

  it('should still reject unknown service', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Rocket Launch',
        details: 'Moon',
        contact: { name: 'Elon' }, research: R,
      },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('Confirm deposit via Stripe', () => {
  let taskId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Oven Cleaning',
        details: 'Single oven',
        contact: { name: 'Alice' }, research: R,
      },
    });
    taskId = res.json().task_id;
  });

  it('should confirm via stripe provider', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit`,
      payload: {
        provider: 'stripe',
        payment_intent_id: 'pi_test_123',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('pending');
  });

  it('should show deposit_provider as stripe', async () => {
    const res = await app.inject({ method: 'GET', url: `/tasks/${taskId}` });
    const body = res.json();
    expect(body.status).toBe('pending');
    expect(body.deposit_provider).toBe('stripe');
    expect(body.deposit_status).toBe('held');
  });
});

describe('Confirm deposit via USDC', () => {
  let taskId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Oven Cleaning',
        details: 'Range cooker',
        contact: { name: 'Charlie' }, research: R,
      },
    });
    taskId = res.json().task_id;
  });

  it('should confirm via usdc_base provider', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit`,
      payload: {
        provider: 'usdc_base',
        tx_hash: '0xabcdef1234567890',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('pending');
  });

  it('should show deposit_provider as usdc_base', async () => {
    const res = await app.inject({ method: 'GET', url: `/tasks/${taskId}` });
    const body = res.json();
    expect(body.deposit_provider).toBe('usdc_base');
    expect(body.deposit_status).toBe('held');
  });
});

describe('Deposit confirmation edge cases', () => {
  it('should reject unknown provider type', async () => {
    const res1 = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Oven Cleaning',
        details: 'Test',
        contact: { name: 'Dave' }, research: R,
      },
    });
    const taskId = res1.json().task_id;

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit`,
      payload: { provider: 'paypal', some_field: 'abc' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_PROVIDER');
  });

  it('should reject confirm on non-deposit task', async () => {
    const res1 = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Plumbing',
        details: 'Test',
        contact: { name: 'Eve' }, research: R,
      },
    });
    const taskId = res1.json().task_id;

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit`,
      payload: { provider: 'stripe', payment_intent_id: 'pi_test_123' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('should reject wrong Stripe payment_intent_id', async () => {
    const res1 = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Oven Cleaning',
        details: 'Test',
        contact: { name: 'Frank' }, research: R,
      },
    });
    const taskId = res1.json().task_id;

    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit`,
      payload: { provider: 'stripe', payment_intent_id: 'pi_wrong' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('DEPOSIT_NOT_CONFIRMED');
  });
});

describe('Full lifecycle with Stripe deposit', () => {
  let taskId: string;

  it('Step 1: Create task', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Oven Cleaning',
        details: 'Double oven, M20 4BX',
        contact: { name: 'Grace', phone: '07700900000' }, research: R,
      },
    });
    taskId = res.json().task_id;
    expect(res.json().status).toBe('pending_deposit');
  });

  it('Step 2: Confirm deposit via Stripe', async () => {
    await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit`,
      payload: { provider: 'stripe', payment_intent_id: 'pi_test_123' },
    });
  });

  it('Step 3: Business accepts, progresses, completes', async () => {
    for (const status of ['accepted', 'in_progress', 'completed']) {
      const res = await app.inject({
        method: 'POST',
        url: `/tasks/${taskId}/events`,
        headers: { authorization: `Bearer ${TEST_CONFIG.businessApiKey}` },
        payload: { status },
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it('Step 4: Deposit was auto-released on completion', async () => {
    const res = await app.inject({ method: 'GET', url: `/tasks/${taskId}` });
    const body = res.json();
    expect(body.status).toBe('completed');
    expect(body.deposit_provider).toBe('stripe');
    expect(body.deposit_status).toBe('released');
    const statuses = body.events.map((e: any) => e.status);
    expect(statuses).toEqual(['pending_deposit', 'pending', 'accepted', 'in_progress', 'completed']);
  });

  it('Step 5: Manual release returns 409 (already released)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit/release`,
      headers: { authorization: `Bearer ${TEST_CONFIG.businessApiKey}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('INVALID_DEPOSIT_STATE');
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
        details: 'Test',
        contact: { name: 'Heidi' }, research: R,
      },
    });
    taskId = res.json().task_id;
    await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit`,
      payload: { provider: 'stripe', payment_intent_id: 'pi_test_123' },
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

  it('should reject double capture', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit/capture`,
      headers: { authorization: `Bearer ${TEST_CONFIG.businessApiKey}` },
    });
    expect(res.statusCode).toBe(409);
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
        contact: { name: 'Ivan' }, research: R,
      },
    });
    taskId = res.json().task_id;
    await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit`,
      payload: { provider: 'stripe', payment_intent_id: 'pi_test_123' },
    });
  });

  it('capture rejects missing auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit/capture`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('release rejects wrong key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/deposit/release`,
      headers: { authorization: 'Bearer wrong_key' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Cancel pending_deposit task', () => {
  let taskId: string;

  it('should create a deposit task', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Oven Cleaning',
        details: 'Test cancel',
        contact: { name: 'Zara' }, research: R,
      },
    });
    expect(res.statusCode).toBe(201);
    taskId = res.json().task_id;
    expect(res.json().status).toBe('pending_deposit');
  });

  it('business should be able to cancel a pending_deposit task', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/events`,
      headers: { authorization: `Bearer ${TEST_CONFIG.businessApiKey}` },
      payload: { status: 'cancelled', message: 'Deposit never confirmed, cleaning up' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('task should show as cancelled', async () => {
    const res = await app.inject({ method: 'GET', url: `/tasks/${taskId}` });
    const body = res.json();
    expect(body.status).toBe('cancelled');
    expect(body.events).toHaveLength(2);
    expect(body.events[0].status).toBe('pending_deposit');
    expect(body.events[1].status).toBe('cancelled');
  });
});

describe('GET /services (provider-agnostic)', () => {
  it('should show deposit config with providers array', async () => {
    const res = await app.inject({ method: 'GET', url: '/services' });
    const services = res.json();
    expect(services[0].deposit).toEqual({
      amount_cents: 1500,
      providers: ['stripe', 'usdc_base'],
    });
    expect(services[1].deposit).toBeNull();
  });
});

describe('GET /.well-known/inverseclaw (provider-agnostic)', () => {
  it('should include deposit config in manifest', async () => {
    const res = await app.inject({ method: 'GET', url: '/.well-known/inverseclaw' });
    const svc = res.json().services[0];
    expect(svc.deposit.providers).toContain('stripe');
    expect(svc.deposit.providers).toContain('usdc_base');
  });
});
