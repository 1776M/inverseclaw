import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { registerRoutes } from '../src/routes.js';
import type { AppConfig } from '../src/config.js';
import type { Service } from '../src/services.js';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdirSync, existsSync, rmSync } from 'node:fs';

const TEST_DB_DIR = join(process.cwd(), 'data-test');
const TEST_DB_PATH = join(TEST_DB_DIR, 'test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

const TEST_CONFIG: AppConfig = {
  nodeId: 'abc123',
  businessApiKey: 'ic_biz_testkey123',
  businessName: 'Test Business',
  contactEmail: 'test@example.com',
  contactPhone: '+441234567890',
  presenceUrls: ['https://example.com'],
  autoPublish: false,
  port: 0,
};

const TEST_SERVICES: Service[] = [
  {
    name: 'Oven Cleaning',
    description: 'Professional oven cleaning',
    service_area: { country: 'GB', regions: ['M', 'SK'] },
  },
  {
    name: 'Plumbing',
    description: 'Emergency plumbing services',
  },
];

const VALID_RESEARCH = {
  urls_checked: ['https://example.com'],
  summary: 'Business verified on example.com',
};

let prisma: PrismaClient;
let app: ReturnType<typeof Fastify>;

beforeAll(async () => {
  // Set up test database
  if (!existsSync(TEST_DB_DIR)) {
    mkdirSync(TEST_DB_DIR, { recursive: true });
  }

  // Push schema to test database
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
  // Clean up test database
  if (existsSync(TEST_DB_DIR)) {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  }
});

describe('GET /health', () => {
  it('should return node info', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.node_id).toBe('abc123');
    expect(body.version).toBe('1.0.0');
    expect(typeof body.uptime_seconds).toBe('number');
  });
});

describe('GET /services', () => {
  it('should return loaded services', async () => {
    const res = await app.inject({ method: 'GET', url: '/services' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0].name).toBe('Oven Cleaning');
    expect(body[1].name).toBe('Plumbing');
  });

  it('should include service_area when present', async () => {
    const res = await app.inject({ method: 'GET', url: '/services' });
    const body = res.json();
    expect(body[0].service_area).toEqual({ country: 'GB', regions: ['M', 'SK'] });
    expect(body[1].service_area).toBeNull();
  });
});

describe('GET /.well-known/inverseclaw', () => {
  it('should return the discovery manifest', async () => {
    const res = await app.inject({ method: 'GET', url: '/.well-known/inverseclaw' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.protocol).toBe('inverseclaw');
    expect(body.version).toBe('1.0.0');
    expect(body.node_id).toBe('abc123');
    expect(body.business_name).toBe('Test Business');
    expect(body.contact_email).toBe('test@example.com');
    expect(body.services).toHaveLength(2);
    expect(body.presence_urls).toEqual(['https://example.com']);
  });
});

describe('POST /tasks', () => {
  it('should create a task and return ids', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Oven Cleaning',
        details: 'Double oven, M1 2AB, next week',
        contact: { name: 'Jane Smith', email: 'jane@test.com' },
        research: VALID_RESEARCH,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.task_id).toMatch(/^tsk_[a-z0-9]{12}$/);
    expect(body.transaction_id).toMatch(/^ic_abc123_\d{8}T\d{6}_[a-z0-9]{5}$/);
    expect(body.status).toBe('pending');
  });

  it('should match service name case-insensitively', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'oven cleaning',
        details: 'Test',
        contact: { name: 'Test' },
        research: VALID_RESEARCH,
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it('should reject unknown service', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Rocket Launch',
        details: 'To the moon',
        contact: { name: 'Elon' },
        research: VALID_RESEARCH,
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('SERVICE_NOT_FOUND');
  });

  it('should reject missing fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: { service_name: 'Oven Cleaning' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /tasks/:task_id', () => {
  let taskId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Plumbing',
        details: 'Leaky tap in kitchen',
        contact: { name: 'Bob', phone: '07700900000' },
        research: VALID_RESEARCH,
      },
    });
    taskId = res.json().task_id;
  });

  it('should return task details', async () => {
    const res = await app.inject({ method: 'GET', url: `/tasks/${taskId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.task_id).toBe(taskId);
    expect(body.service_name).toBe('Plumbing');
    expect(body.details).toBe('Leaky tap in kitchen');
    expect(body.contact.name).toBe('Bob');
    expect(body.status).toBe('pending');
    expect(body.events).toHaveLength(1);
    expect(body.events[0].status).toBe('pending');
  });

  it('should return 404 for unknown task', async () => {
    const res = await app.inject({ method: 'GET', url: '/tasks/tsk_doesnotexist' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('TASK_NOT_FOUND');
  });
});

describe('POST /tasks/:task_id/events', () => {
  let taskId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Oven Cleaning',
        details: 'Single oven',
        contact: { name: 'Alice' },
        research: VALID_RESEARCH,
      },
    });
    taskId = res.json().task_id;
  });

  it('should reject missing auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/events`,
      payload: { status: 'accepted' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('should reject wrong API key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/events`,
      headers: { authorization: 'Bearer wrong_key' },
      payload: { status: 'accepted' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('should accept valid status update', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/events`,
      headers: { authorization: `Bearer ${TEST_CONFIG.businessApiKey}` },
      payload: { status: 'accepted', message: 'Coming Tuesday 10am' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().updated).toBe(true);
  });

  it('should reflect the status update in task details', async () => {
    const res = await app.inject({ method: 'GET', url: `/tasks/${taskId}` });
    const body = res.json();
    expect(body.status).toBe('accepted');
    expect(body.events).toHaveLength(2);
    expect(body.events[1].status).toBe('accepted');
    expect(body.events[1].message).toBe('Coming Tuesday 10am');
  });

  it('should reject invalid state transition', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/events`,
      headers: { authorization: `Bearer ${TEST_CONFIG.businessApiKey}` },
      payload: { status: 'completed' },
    });
    // accepted → completed is not valid (must go through in_progress)
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('INVALID_TRANSITION');
  });

  it('should allow the full lifecycle: accepted → in_progress → completed', async () => {
    // Move to in_progress
    let res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/events`,
      headers: { authorization: `Bearer ${TEST_CONFIG.businessApiKey}` },
      payload: { status: 'in_progress', message: 'On our way' },
    });
    expect(res.statusCode).toBe(200);

    // Move to completed
    res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/events`,
      headers: { authorization: `Bearer ${TEST_CONFIG.businessApiKey}` },
      payload: { status: 'completed', message: 'Job done' },
    });
    expect(res.statusCode).toBe(200);

    // Verify final state
    res = await app.inject({ method: 'GET', url: `/tasks/${taskId}` });
    const body = res.json();
    expect(body.status).toBe('completed');
    expect(body.events).toHaveLength(4); // pending, accepted, in_progress, completed
  });
});
