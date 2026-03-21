/**
 * Research requirement tests.
 *
 * Tests that the server enforces research before task submission
 * when researchRequired is true (the default in production).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { registerRoutes } from '../src/routes.js';
import type { AppConfig } from '../src/config.js';
import type { Service } from '../src/services.js';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdirSync, existsSync, rmSync } from 'node:fs';

const TEST_DB_DIR = join(process.cwd(), 'data-test-research');
const TEST_DB_PATH = join(TEST_DB_DIR, 'research.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

const TEST_CONFIG: AppConfig = {
  nodeId: 'res123',
  businessApiKey: 'ic_biz_research_test',
  businessName: 'Research Test Business',
  contactEmail: 'test@research.com',
  presenceUrls: ['https://checkatrade.com/trades/testbiz', 'https://facebook.com/testbiz'],
  autoPublish: false,
  port: 0,
};

const TEST_SERVICES: Service[] = [
  {
    name: 'Oven Cleaning',
    description: 'Professional oven cleaning',
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
  app = Fastify();
  registerRoutes(app, TEST_CONFIG, TEST_SERVICES, prisma);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  if (existsSync(TEST_DB_DIR)) {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  }
});

describe('Research requirement', () => {
  it('manifest should include research_required: true', async () => {
    const res = await app.inject({ method: 'GET', url: '/.well-known/inverseclaw' });
    expect(res.json().research_required).toBe(true);
  });

  it('should reject task without research', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Oven Cleaning',
        details: 'Double oven',
        contact: { name: 'Jane' },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('RESEARCH_REQUIRED');
  });

  it('should reject task with empty research urls', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Oven Cleaning',
        details: 'Double oven',
        contact: { name: 'Jane' },
        research: { urls_checked: [], summary: 'Looks good' },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('should reject task with empty research summary', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Oven Cleaning',
        details: 'Double oven',
        contact: { name: 'Jane' },
        research: { urls_checked: ['https://checkatrade.com/trades/testbiz'], summary: '' },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('should accept task with valid research', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Oven Cleaning',
        details: 'Double oven, M1 2AB',
        contact: { name: 'Jane', email: 'jane@test.com' },
        research: {
          urls_checked: [
            'https://checkatrade.com/trades/testbiz',
            'https://facebook.com/testbiz',
          ],
          summary: 'Business has 47 reviews on Checkatrade (4.8 average) and active Facebook page since 2019. Appears legitimate.',
        },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().task_id).toMatch(/^tsk_/);
  });
});
