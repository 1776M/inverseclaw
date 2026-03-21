/**
 * Deposit-aware route registrar (v1.1)
 *
 * Registers ALL routes including the deposit-aware POST /tasks and
 * three new deposit endpoints. Used when any service has deposit_required.
 *
 * Routes that are unchanged from routes.ts are duplicated here to avoid
 * modifying the original file. Fastify does not allow duplicate route paths,
 * so index.ts calls either registerRoutes OR registerDepositRoutes, never both.
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
import { createDepositHold, captureDeposit, releaseDeposit } from './stripe.js';
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
  // GET /health (same as routes.ts)
  app.get('/health', async () => {
    return {
      node_id: config.nodeId,
      version: SERVER_VERSION,
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    };
  });

  // GET /services (extended to include deposit info)
  app.get('/services', async () => {
    return services.map((s) => ({
      name: s.name,
      description: s.description,
      service_area: s.service_area ?? null,
      deposit_required: s.deposit_required ?? false,
      deposit_amount_pence: s.deposit_amount_pence ?? null,
    }));
  });

  // GET /.well-known/inverseclaw (extended to include deposit info)
  app.get('/.well-known/inverseclaw', async () => {
    return {
      protocol: 'inverseclaw',
      version: PROTOCOL_VERSION,
      node_id: config.nodeId,
      business_name: config.businessName,
      contact_email: config.contactEmail,
      contact_phone: config.contactPhone ?? null,
      endpoint: `http://localhost:${config.port}`,
      services: services.map((s) => ({
        name: s.name,
        description: s.description,
        service_area: s.service_area ?? null,
        deposit_required: s.deposit_required ?? false,
        deposit_amount_pence: s.deposit_amount_pence ?? null,
      })),
      presence_urls: config.presenceUrls,
    };
  });

  // POST /tasks (deposit-aware)
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
    const needsDeposit = matchedService.deposit_required === true;

    if (needsDeposit) {
      // Create Stripe hold
      const { paymentIntentId, clientSecret } = await createDepositHold(
        matchedService.deposit_amount_pence!,
        `Inverse Claw deposit: ${matchedService.name} (${transactionId})`
      );

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
          depositAmountPence: matchedService.deposit_amount_pence!,
          stripePaymentIntentId: paymentIntentId,
          depositStatus: null,
          events: {
            create: {
              status: 'pending_deposit',
              message: `Task submitted — deposit hold of £${(matchedService.deposit_amount_pence! / 100).toFixed(2)} required`,
            },
          },
        },
      });

      reply.status(201);
      return {
        task_id: taskId,
        transaction_id: transactionId,
        status: 'pending_deposit',
        stripe_client_secret: clientSecret,
        deposit_amount_pence: matchedService.deposit_amount_pence!,
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

  // GET /tasks/:task_id (extended with deposit fields)
  app.get<{ Params: { task_id: string } }>('/tasks/:task_id', async (request, reply) => {
    const { task_id } = request.params;

    const task = await prisma.task.findUnique({
      where: { taskId: task_id },
      include: {
        events: {
          orderBy: { createdAt: 'asc' },
        },
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

      return { updated: true };
    }
  );

  // --- NEW deposit endpoints ---

  // POST /tasks/:task_id/deposit — agent confirms deposit hold
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
      const { payment_intent_id } = parsed.data;

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

      if (payment_intent_id !== task.stripePaymentIntentId) {
        reply.status(400);
        return errorResponse('payment_intent_id does not match', 'INVALID_PAYMENT_INTENT');
      }

      await prisma.$transaction([
        prisma.taskEvent.create({
          data: {
            taskId: task_id,
            status: 'pending',
            message: 'Deposit confirmed — task is now pending',
          },
        }),
        prisma.task.update({
          where: { taskId: task_id },
          data: {
            status: 'pending',
            depositStatus: 'held',
          },
        }),
      ]);

      return { updated: true, status: 'pending' };
    }
  );

  // POST /tasks/:task_id/deposit/capture — business captures hold on no-show
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

      await captureDeposit(task.stripePaymentIntentId!);

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

      await releaseDeposit(task.stripePaymentIntentId!);

      await prisma.task.update({
        where: { taskId: task_id },
        data: { depositStatus: 'released' },
      });

      return { released: true };
    }
  );
}
