/**
 * End-to-end protocol walkthrough
 *
 * Simulates BOTH sides of the Inverse Claw protocol using Fastify's
 * in-memory .inject() API — no server process, no ports, no crashes.
 *
 * Scenario: A user asks their AI agent to book an oven cleaner in
 * Manchester. The agent discovers the business, submits a task, and
 * the business progresses it through to completion.
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

// --- Test fixtures ---

const TEST_DB_DIR = join(process.cwd(), 'data-test-walkthrough');
const TEST_DB_PATH = join(TEST_DB_DIR, 'walkthrough.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

const BUSINESS_CONFIG: AppConfig = {
  nodeId: 'cr8f2a',
  businessApiKey: 'ic_biz_cleanright_secret_key_0123456789abcdef',
  businessName: 'CleanRight Ltd',
  contactEmail: 'bookings@cleanright.co.uk',
  contactPhone: '+441619871234',
  presenceUrls: [
    'https://checkatrade.com/trades/cleanright',
    'https://facebook.com/cleanrightltd',
  ],
  autoPublish: false,
  port: 0,
};

const BUSINESS_SERVICES: Service[] = [
  {
    name: 'Oven Cleaning',
    description:
      'Professional domestic oven cleaning including racks, glass, and hob. Single ovens from £45, doubles from £65. Greater Manchester area.',
    service_area: { country: 'GB', regions: ['M', 'SK', 'OL', 'WA'] },
  },
  {
    name: 'Kitchen Deep Clean',
    description:
      'Full kitchen deep clean including appliances, cupboard fronts, floor, and surfaces. From £120. Greater Manchester.',
    service_area: { country: 'GB', regions: ['M', 'SK', 'OL'] },
  },
];

const VALID_RESEARCH = {
  urls_checked: ['https://checkatrade.com/trades/cleanright', 'https://facebook.com/cleanrightltd'],
  summary: 'CleanRight has 4.9 stars on Checkatrade with 120+ reviews. Active Facebook since 2019.',
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
  app = Fastify();
  registerRoutes(app, BUSINESS_CONFIG, BUSINESS_SERVICES, prisma);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  if (existsSync(TEST_DB_DIR)) {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------
// The walkthrough plays out like a conversation between two actors:
//   🤖 AGENT  — acting on behalf of the user (Jane Smith)
//   🏢 BUSINESS — CleanRight Ltd responding to the request
// ---------------------------------------------------------------

describe('Full protocol walkthrough', () => {
  let taskId: string;
  let transactionId: string;

  // --------------------------------------------------
  // Step 1 — AGENT discovers the business via /.well-known
  // --------------------------------------------------
  it('Step 1: Agent discovers the business via /.well-known/inverseclaw', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/inverseclaw',
    });

    expect(res.statusCode).toBe(200);
    const manifest = res.json();

    // Agent reads the manifest and learns about this business
    expect(manifest.protocol).toBe('inverseclaw');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.business_name).toBe('CleanRight Ltd');
    expect(manifest.contact_email).toBe('bookings@cleanright.co.uk');
    expect(manifest.services).toHaveLength(2);
    expect(manifest.presence_urls).toContain(
      'https://checkatrade.com/trades/cleanright'
    );

    // Agent would present this to the user:
    // "I found CleanRight Ltd — they have profiles on Checkatrade and
    //  Facebook. They offer Oven Cleaning and Kitchen Deep Clean in
    //  Greater Manchester. Shall I submit a request?"
  });

  // --------------------------------------------------
  // Step 2 — AGENT browses the available services
  // --------------------------------------------------
  it('Step 2: Agent browses available services', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/services',
    });

    expect(res.statusCode).toBe(200);
    const services = res.json();

    expect(services).toHaveLength(2);

    const ovenCleaning = services.find(
      (s: any) => s.name === 'Oven Cleaning'
    );
    expect(ovenCleaning).toBeDefined();
    expect(ovenCleaning.description).toContain('Single ovens from £45');
    expect(ovenCleaning.service_area.regions).toContain('M');
  });

  // --------------------------------------------------
  // Step 3 — AGENT submits a task on behalf of the user
  // --------------------------------------------------
  it('Step 3: Agent submits a task for the user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Oven Cleaning',
        details:
          'Double oven, postcode M1 2AB, prefer next week. Dog in the house (friendly).',
        contact: {
          name: 'Jane Smith',
          phone: '07700900123',
          email: 'jane@email.com',
        },
        research: VALID_RESEARCH,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();

    // Save IDs for subsequent steps
    taskId = body.task_id;
    transactionId = body.transaction_id;

    expect(taskId).toMatch(/^tsk_[a-z0-9]{12}$/);
    expect(transactionId).toMatch(/^ic_cr8f2a_\d{8}T\d{6}_[a-z0-9]{5}$/);
    expect(body.status).toBe('pending');

    // Agent would tell the user:
    // "Done — I've submitted a request to CleanRight Ltd for oven cleaning.
    //  Your reference is ic_cr8f2a_20260321T... I'll let you know when
    //  they respond."
  });

  // --------------------------------------------------
  // Step 4 — AGENT polls the task (still pending)
  // --------------------------------------------------
  it('Step 4: Agent polls — task is still pending', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/tasks/${taskId}`,
    });

    expect(res.statusCode).toBe(200);
    const task = res.json();

    expect(task.task_id).toBe(taskId);
    expect(task.transaction_id).toBe(transactionId);
    expect(task.service_name).toBe('Oven Cleaning');
    expect(task.status).toBe('pending');
    expect(task.events).toHaveLength(1);
    expect(task.events[0].status).toBe('pending');
  });

  // --------------------------------------------------
  // Step 5 — BUSINESS accepts the task
  // --------------------------------------------------
  it('Step 5: Business accepts the task', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/events`,
      headers: {
        authorization: `Bearer ${BUSINESS_CONFIG.businessApiKey}`,
      },
      payload: {
        status: 'accepted',
        message: 'Booked for Tuesday 25th March, 10am. Double oven = £65.',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().updated).toBe(true);
  });

  // --------------------------------------------------
  // Step 6 — AGENT polls and sees the acceptance
  // --------------------------------------------------
  it('Step 6: Agent polls — task is accepted', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/tasks/${taskId}`,
    });

    const task = res.json();
    expect(task.status).toBe('accepted');
    expect(task.events).toHaveLength(2);
    expect(task.events[1].status).toBe('accepted');
    expect(task.events[1].message).toContain('Tuesday 25th March');
    expect(task.events[1].message).toContain('£65');

    // Agent would tell the user:
    // "CleanRight has accepted your request! They've booked you in for
    //  Tuesday 25th March at 10am. The price is £65 for a double oven."
  });

  // --------------------------------------------------
  // Step 7 — BUSINESS marks in progress (technician dispatched)
  // --------------------------------------------------
  it('Step 7: Business marks task in progress', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/events`,
      headers: {
        authorization: `Bearer ${BUSINESS_CONFIG.businessApiKey}`,
      },
      payload: {
        status: 'in_progress',
        message: 'Technician Dave is on his way. ETA 15 minutes.',
      },
    });

    expect(res.statusCode).toBe(200);
  });

  // --------------------------------------------------
  // Step 8 — AGENT polls and sees in_progress
  // --------------------------------------------------
  it('Step 8: Agent polls — technician is on the way', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/tasks/${taskId}`,
    });

    const task = res.json();
    expect(task.status).toBe('in_progress');
    expect(task.events).toHaveLength(3);
    expect(task.events[2].message).toContain('Dave is on his way');

    // Agent would tell the user:
    // "Technician Dave from CleanRight is on his way — ETA 15 minutes."
  });

  // --------------------------------------------------
  // Step 9 — BUSINESS marks completed
  // --------------------------------------------------
  it('Step 9: Business marks task completed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/events`,
      headers: {
        authorization: `Bearer ${BUSINESS_CONFIG.businessApiKey}`,
      },
      payload: {
        status: 'completed',
        message: 'Job done. Oven, racks, glass, and hob all cleaned. Paid £65 cash on site.',
      },
    });

    expect(res.statusCode).toBe(200);
  });

  // --------------------------------------------------
  // Step 10 — AGENT polls final state and sees full history
  // --------------------------------------------------
  it('Step 10: Agent sees the completed task with full event history', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/tasks/${taskId}`,
    });

    const task = res.json();
    expect(task.status).toBe('completed');
    expect(task.events).toHaveLength(4);

    // Verify the full event timeline
    const statuses = task.events.map((e: any) => e.status);
    expect(statuses).toEqual([
      'pending',
      'accepted',
      'in_progress',
      'completed',
    ]);

    // Verify the final event
    const finalEvent = task.events[3];
    expect(finalEvent.status).toBe('completed');
    expect(finalEvent.message).toContain('Job done');

    // Verify the task still has all the original details
    expect(task.contact.name).toBe('Jane Smith');
    expect(task.contact.email).toBe('jane@email.com');
    expect(task.transaction_id).toBe(transactionId);

    // Agent would tell the user:
    // "Your oven cleaning is complete! Dave cleaned the oven, racks,
    //  glass, and hob. You paid £65 cash on site. Your reference for
    //  any follow-up is ic_cr8f2a_..."
  });

  // --------------------------------------------------
  // Step 11 — Verify terminal state is enforced
  // --------------------------------------------------
  it('Step 11: Business cannot update a completed task', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/events`,
      headers: {
        authorization: `Bearer ${BUSINESS_CONFIG.businessApiKey}`,
      },
      payload: {
        status: 'cancelled',
        message: 'Trying to cancel after completion',
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('INVALID_TRANSITION');
  });
});

// ---------------------------------------------------------------
// Second scenario: task gets declined
// ---------------------------------------------------------------

describe('Declined task walkthrough', () => {
  let taskId: string;

  it('Agent submits a task', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Kitchen Deep Clean',
        details: 'Full kitchen clean, postcode OL1 3AA, this Saturday.',
        contact: {
          name: 'Tom Baker',
          email: 'tom@email.com',
        },
        research: VALID_RESEARCH,
      },
    });

    expect(res.statusCode).toBe(201);
    taskId = res.json().task_id;
  });

  it('Business declines — fully booked', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/events`,
      headers: {
        authorization: `Bearer ${BUSINESS_CONFIG.businessApiKey}`,
      },
      payload: {
        status: 'declined',
        message: 'Sorry, fully booked this Saturday. Try next week?',
      },
    });

    expect(res.statusCode).toBe(200);
  });

  it('Agent sees the decline with the message', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/tasks/${taskId}`,
    });

    const task = res.json();
    expect(task.status).toBe('declined');
    expect(task.events).toHaveLength(2);
    expect(task.events[1].message).toContain('fully booked');

    // Agent would tell the user:
    // "CleanRight declined — they're fully booked this Saturday.
    //  They suggest trying next week. Want me to search for other
    //  providers or resubmit for next week?"
  });
});

// ---------------------------------------------------------------
// Third scenario: task gets cancelled by the business
// ---------------------------------------------------------------

describe('Cancelled task walkthrough', () => {
  let taskId: string;

  it('Agent submits and business accepts', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        service_name: 'Oven Cleaning',
        details: 'Single oven, M20 4BX, Wednesday.',
        contact: { name: 'Sarah Connor', phone: '07700900456' },
        research: VALID_RESEARCH,
      },
    });
    taskId = res.json().task_id;

    await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/events`,
      headers: {
        authorization: `Bearer ${BUSINESS_CONFIG.businessApiKey}`,
      },
      payload: { status: 'accepted', message: 'Confirmed for Wednesday 2pm.' },
    });
  });

  it('Business cancels after accepting', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/events`,
      headers: {
        authorization: `Bearer ${BUSINESS_CONFIG.businessApiKey}`,
      },
      payload: {
        status: 'cancelled',
        message: 'Technician called in sick. Apologies — can reschedule to Thursday?',
      },
    });

    expect(res.statusCode).toBe(200);
  });

  it('Agent sees cancellation and reason', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/tasks/${taskId}`,
    });

    const task = res.json();
    expect(task.status).toBe('cancelled');
    expect(task.events).toHaveLength(3);

    const statuses = task.events.map((e: any) => e.status);
    expect(statuses).toEqual(['pending', 'accepted', 'cancelled']);
    expect(task.events[2].message).toContain('Technician called in sick');
  });
});
