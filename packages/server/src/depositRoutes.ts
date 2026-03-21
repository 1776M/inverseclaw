/**
 * Deposit-aware route registrar (v1.1, provider-agnostic)
 *
 * Registers ALL routes including deposit-aware POST /tasks and
 * deposit management endpoints. Used when any service has a deposit config.
 *
 * Supports multiple deposit providers (Stripe, USDC on Base, etc.).
 * When a task requires a deposit, the response includes all provider
 * options so the agent can pick one the user can use.
 */
import type { FastifyInstance } from 'fastify';
import type { DepositConfig } from './config.js';
import type { ExtendedService } from './services.js';
import {
  CreateTaskBody,
  PushEventBody,
  ConfirmDepositBody,
  isValidDepositTransition,
} from './schemas.js';
import { generateTransactionId, generateTaskId } from './transaction.js';
import { getProvider } from './depositProvider.js';
import { PrismaClient } from '@prisma/client';

const PROTOCOL_VERSION = '1.0.0';
const SERVER_VERSION = '1.0.0';
const startTime = Date.now();

interface ErrorResponse {
  error: string;
  code: string;
}

function errorResponse(error: string, code: string): ErrorResponse {
  return { error, code };
}

export function registerDepositRoutes(
  app: FastifyInstance,
  config: DepositConfig,
  services: ExtendedService[],
  prisma: PrismaClient
): void {
  // GET /health
  app.get('/health', async () => {
    return {
      node_id: config.nodeId,
      version: SERVER_VERSION,
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    };
  });

  // GET /services (includes deposit info)
  app.get('/services', async () => {
    return services.map((s) => ({
      name: s.name,
      description: s.description,
      service_area: s.service_area ?? null,
      deposit: s.deposit
        ? { amount_pence: s.deposit.amount_pence, providers: s.deposit.providers }
        : null,
    }));
  });

  // GET /.well-known/inverseclaw (includes deposit info)
  app.get('/.well-known/inverseclaw', async () => {
    return {
      protocol: 'inverseclaw',
      version: PROTOCOL_VERSION,
      node_id: config.nodeId,
      business_name: config.businessName,
      contact_email: config.contactEmail,
      contact_phone: config.contactPhone ?? null,
      endpoint: config.publicUrl ?? `http://localhost:${config.port}`,
      services: services.map((s) => ({
        name: s.name,
        description: s.description,
        service_area: s.service_area ?? null,
        deposit: s.deposit
          ? { amount_pence: s.deposit.amount_pence, providers: s.deposit.providers }
          : null,
      })),
      presence_urls: config.presenceUrls,
    };
  });

  // POST /tasks (deposit-aware, provider-agnostic)
  app.post('/tasks', async (request, reply) => {
    const parsed = CreateTaskBody.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return errorResponse(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        'VALIDATION_ERROR'
      );
    }

    const body = parsed.data;

    const matchedService = services.find(
      (s) => s.name.toLowerCase() === body.service_name.toLowerCase()
    );
    if (!matchedService) {
      reply.status(404);
      return errorResponse(
        `Service "${body.service_name}" not found. Available: ${services.map((s) => s.name).join(', ')}`,
        'SERVICE_NOT_FOUND'
      );
    }

    const taskId = generateTaskId();
    const transactionId = generateTransactionId(config.nodeId);
    const needsDeposit = matchedService.deposit !== undefined;

    if (needsDeposit) {
      const deposit = matchedService.deposit!;

      // Create deposits with all accepted providers
      const depositProviders: Record<string, Record<string, unknown>> = {};
      const depositInitData: Record<string, string> = {};

      for (const providerType of deposit.providers) {
        const provider = getProvider(providerType);
        const result = await provider.createDeposit({
          amountPence: deposit.amount_pence,
          description: `Inverse Claw deposit: ${matchedService.name} (${transactionId})`,
          taskId,
        });
        depositProviders[providerType] = result.clientData;
        depositInitData[providerType] = result.depositId;
      }

      await prisma.task.create({
        data: {
          taskId,
          transactionId,
          serviceName: matchedService.name,
          details: body.details,
          contactName: body.contact.name,
          contactPhone: body.contact.phone ?? null,
          contactEmail: body.contact.email ?? null,
          status: 'pending_deposit',
          depositRequired: true,
          depositAmountPence: deposit.amount_pence,
          depositInitData: JSON.stringify(depositInitData),
          depositStatus: null,
          events: {
            create: {
              status: 'pending_deposit',
              message: `Task submitted — deposit of £${(deposit.amount_pence / 100).toFixed(2)} required`,
            },
          },
        },
      });

      reply.status(201);
      return {
        task_id: taskId,
        transaction_id: transactionId,
        status: 'pending_deposit',
        deposit_amount_pence: deposit.amount_pence,
        deposit_providers: depositProviders,
      };
    }

    // No deposit — identical to original behaviour
    await prisma.task.create({
      data: {
        taskId,
        transactionId,
        serviceName: matchedService.name,
        details: body.details,
        contactName: body.contact.name,
        contactPhone: body.contact.phone ?? null,
        contactEmail: body.contact.email ?? null,
        status: 'pending',
        events: {
          create: {
            status: 'pending',
            message: 'Task submitted by agent',
          },
        },
      },
    });

    reply.status(201);
    return {
      task_id: taskId,
      transaction_id: transactionId,
      status: 'pending',
    };
  });

  // GET /tasks/:task_id (includes deposit fields)
  app.get<{ Params: { task_id: string } }>('/tasks/:task_id', async (request, reply) => {
    const { task_id } = request.params;

    const task = await prisma.task.findUnique({
      where: { taskId: task_id },
      include: {
        events: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!task) {
      reply.status(404);
      return errorResponse('Task not found', 'TASK_NOT_FOUND');
    }

    return {
      task_id: task.taskId,
      transaction_id: task.transactionId,
      service_name: task.serviceName,
      details: task.details,
      contact: {
        name: task.contactName,
        phone: task.contactPhone,
        email: task.contactEmail,
      },
      status: task.status,
      deposit_required: task.depositRequired,
      deposit_amount_pence: task.depositAmountPence,
      deposit_provider: task.depositProvider,
      deposit_status: task.depositStatus,
      created_at: task.createdAt.toISOString(),
      updated_at: task.updatedAt.toISOString(),
      events: task.events.map((e) => ({
        status: e.status,
        message: e.message,
        created_at: e.createdAt.toISOString(),
      })),
    };
  });

  // POST /tasks/:task_id/events (uses extended state machine)
  app.post<{ Params: { task_id: string } }>(
    '/tasks/:task_id/events',
    async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.status(401);
        return errorResponse('Missing or invalid Authorization header', 'UNAUTHORIZED');
      }

      const providedKey = authHeader.slice(7);
      if (providedKey !== config.businessApiKey) {
        reply.status(401);
        return errorResponse('Invalid API key', 'UNAUTHORIZED');
      }

      const parsed = PushEventBody.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        return errorResponse(
          parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          'VALIDATION_ERROR'
        );
      }

      const { task_id } = request.params;
      const body = parsed.data;

      const task = await prisma.task.findUnique({
        where: { taskId: task_id },
      });

      if (!task) {
        reply.status(404);
        return errorResponse('Task not found', 'TASK_NOT_FOUND');
      }

      if (!isValidDepositTransition(task.status, body.status)) {
        reply.status(409);
        return errorResponse(
          `Cannot transition from "${task.status}" to "${body.status}"`,
          'INVALID_TRANSITION'
        );
      }

      await prisma.$transaction([
        prisma.taskEvent.create({
          data: {
            taskId: task_id,
            status: body.status,
            message: body.message ?? null,
          },
        }),
        prisma.task.update({
          where: { taskId: task_id },
          data: { status: body.status },
        }),
      ]);

      // If cancelling a pending_deposit task, void any created deposits
      if (task.status === 'pending_deposit' && body.status === 'cancelled' && task.depositInitData) {
        try {
          const initData: Record<string, string> = JSON.parse(task.depositInitData);
          for (const [providerType, depositId] of Object.entries(initData)) {
            try {
              const provider = getProvider(providerType);
              await provider.release(depositId);
            } catch {
              // Best effort — provider may not support voiding unredeemed deposits
            }
          }
        } catch {
          // Ignore parse errors on cleanup
        }
      }

      return { updated: true };
    }
  );

  // --- Deposit endpoints (provider-agnostic) ---

  // POST /tasks/:task_id/deposit — agent confirms deposit
  app.post<{ Params: { task_id: string } }>(
    '/tasks/:task_id/deposit',
    async (request, reply) => {
      const parsed = ConfirmDepositBody.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        return errorResponse(
          parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          'VALIDATION_ERROR'
        );
      }

      const { task_id } = request.params;
      const { provider: providerType, ...confirmationData } = parsed.data;

      const task = await prisma.task.findUnique({
        where: { taskId: task_id },
      });

      if (!task) {
        reply.status(404);
        return errorResponse('Task not found', 'TASK_NOT_FOUND');
      }

      if (task.status !== 'pending_deposit') {
        reply.status(409);
        return errorResponse(
          `Task is in "${task.status}" state, not "pending_deposit"`,
          'INVALID_STATE'
        );
      }

      // Look up the deposit ID for this provider from init data
      let initData: Record<string, string>;
      try {
        initData = JSON.parse(task.depositInitData ?? '{}');
      } catch {
        reply.status(500);
        return errorResponse('Corrupt deposit init data', 'INTERNAL_ERROR');
      }

      const depositId = initData[providerType];
      if (!depositId) {
        reply.status(400);
        return errorResponse(
          `Provider "${providerType}" was not offered for this task`,
          'INVALID_PROVIDER'
        );
      }

      // Verify with the provider
      let provider;
      try {
        provider = getProvider(providerType);
      } catch {
        reply.status(400);
        return errorResponse(
          `Unknown deposit provider: "${providerType}"`,
          'INVALID_PROVIDER'
        );
      }

      const confirmed = await provider.confirmDeposit(
        depositId,
        confirmationData as Record<string, string>
      );

      if (!confirmed) {
        reply.status(400);
        return errorResponse('Deposit confirmation failed', 'DEPOSIT_NOT_CONFIRMED');
      }

      await prisma.$transaction([
        prisma.taskEvent.create({
          data: {
            taskId: task_id,
            status: 'pending',
            message: `Deposit confirmed via ${providerType} — task is now pending`,
          },
        }),
        prisma.task.update({
          where: { taskId: task_id },
          data: {
            status: 'pending',
            depositProvider: providerType,
            depositProviderId: depositId,
            depositStatus: 'held',
          },
        }),
      ]);

      return { updated: true, status: 'pending' };
    }
  );

  // POST /tasks/:task_id/deposit/capture — business captures on no-show
  app.post<{ Params: { task_id: string } }>(
    '/tasks/:task_id/deposit/capture',
    async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.status(401);
        return errorResponse('Missing or invalid Authorization header', 'UNAUTHORIZED');
      }
      if (authHeader.slice(7) !== config.businessApiKey) {
        reply.status(401);
        return errorResponse('Invalid API key', 'UNAUTHORIZED');
      }

      const { task_id } = request.params;

      const task = await prisma.task.findUnique({
        where: { taskId: task_id },
      });

      if (!task) {
        reply.status(404);
        return errorResponse('Task not found', 'TASK_NOT_FOUND');
      }

      if (!task.depositRequired) {
        reply.status(400);
        return errorResponse('Task does not have a deposit', 'NO_DEPOSIT');
      }

      if (task.depositStatus !== 'held') {
        reply.status(409);
        return errorResponse(
          `Deposit is "${task.depositStatus}", not "held"`,
          'INVALID_DEPOSIT_STATE'
        );
      }

      const provider = getProvider(task.depositProvider!);
      await provider.capture(task.depositProviderId!);

      await prisma.task.update({
        where: { taskId: task_id },
        data: { depositStatus: 'captured' },
      });

      return { captured: true };
    }
  );

  // POST /tasks/:task_id/deposit/release — business releases hold
  app.post<{ Params: { task_id: string } }>(
    '/tasks/:task_id/deposit/release',
    async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.status(401);
        return errorResponse('Missing or invalid Authorization header', 'UNAUTHORIZED');
      }
      if (authHeader.slice(7) !== config.businessApiKey) {
        reply.status(401);
        return errorResponse('Invalid API key', 'UNAUTHORIZED');
      }

      const { task_id } = request.params;

      const task = await prisma.task.findUnique({
        where: { taskId: task_id },
      });

      if (!task) {
        reply.status(404);
        return errorResponse('Task not found', 'TASK_NOT_FOUND');
      }

      if (!task.depositRequired) {
        reply.status(400);
        return errorResponse('Task does not have a deposit', 'NO_DEPOSIT');
      }

      if (task.depositStatus !== 'held') {
        reply.status(409);
        return errorResponse(
          `Deposit is "${task.depositStatus}", not "held"`,
          'INVALID_DEPOSIT_STATE'
        );
      }

      const provider = getProvider(task.depositProvider!);
      await provider.release(task.depositProviderId!);

      await prisma.task.update({
        where: { taskId: task_id },
        data: { depositStatus: 'released' },
      });

      return { released: true };
    }
  );
}
