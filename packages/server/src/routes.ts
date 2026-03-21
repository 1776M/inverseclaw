import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import type { Service } from './services.js';
import { CreateTaskBody, PushEventBody, isValidTransition } from './schemas.js';
import { generateTransactionId, generateTaskId } from './transaction.js';
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

export function registerRoutes(
  app: FastifyInstance,
  config: AppConfig,
  services: Service[],
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

  // GET /services
  app.get('/services', async () => {
    return services.map((s) => ({
      name: s.name,
      description: s.description,
      service_area: s.service_area ?? null,
    }));
  });

  // GET /.well-known/inverseclaw
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
      })),
      presence_urls: config.presenceUrls,
    };
  });

  // POST /tasks
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

    // Check service exists
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

  // GET /tasks/:task_id
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
      created_at: task.createdAt.toISOString(),
      updated_at: task.updatedAt.toISOString(),
      events: task.events.map((e) => ({
        status: e.status,
        message: e.message,
        created_at: e.createdAt.toISOString(),
      })),
    };
  });

  // POST /tasks/:task_id/events
  app.post<{ Params: { task_id: string } }>(
    '/tasks/:task_id/events',
    async (request, reply) => {
      // Auth check
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

      // Validate body
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

      if (!isValidTransition(task.status, body.status)) {
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
}
