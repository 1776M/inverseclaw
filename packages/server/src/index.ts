import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from './config.js';
import { loadServices } from './services.js';
import { loadDepositConfig } from './config.js';
import { loadServicesWithDeposit } from './services.js';
import { registerRoutes } from './routes.js';
import { registerDepositRoutes } from './depositRoutes.js';
import { initStripe } from './stripe.js';

async function main(): Promise<void> {
  // Load config and services (extended versions that support deposit fields)
  const config = loadDepositConfig();
  const services = loadServicesWithDeposit(process.env.SERVICES_FILE);

  console.log(`Loaded ${services.length} service(s) from services.yaml`);
  for (const s of services) {
    console.log(`  - ${s.name}${s.deposit_required ? ` (deposit: £${(s.deposit_amount_pence! / 100).toFixed(2)})` : ''}`);
  }

  // Check if any service requires deposits
  const anyDepositRequired = services.some((s) => s.deposit_required);

  if (anyDepositRequired) {
    if (!config.stripeSecretKey) {
      throw new Error(
        'STRIPE_SECRET_KEY environment variable is required when any service has deposit_required: true'
      );
    }
    initStripe(config.stripeSecretKey);
    console.log('Stripe initialized for deposit holds');
  }

  // Initialize database
  const prisma = new PrismaClient();

  // Create Fastify app
  const app = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    },
  });

  // Register routes — deposit-aware version if any service needs deposits
  if (anyDepositRequired) {
    registerDepositRoutes(app, config, services, prisma);
  } else {
    registerRoutes(app, config, services, prisma);
  }

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log('Shutting down...');
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start server
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`\nInverse Claw Server running on port ${config.port}`);
    console.log(`  Node ID:    ${config.nodeId}`);
    console.log(`  Health:     http://localhost:${config.port}/health`);
    console.log(`  Services:   http://localhost:${config.port}/services`);
    console.log(`  Discovery:  http://localhost:${config.port}/.well-known/inverseclaw`);
    if (anyDepositRequired) {
      console.log(`  Deposits:   enabled (Stripe)`);
    }
    console.log('');
  } catch (err) {
    console.error('Failed to start server:', err);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
