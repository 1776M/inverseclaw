import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from './config.js';
import { loadServices } from './services.js';
import { loadDepositConfig } from './config.js';
import { loadServicesWithDeposit } from './services.js';
import { registerRoutes } from './routes.js';
import { registerDepositRoutes } from './depositRoutes.js';
import { registerProvider, getRegisteredProviderTypes } from './depositProvider.js';
import { createWebhookNotifier } from './webhooks.js';
import { StripeDepositProvider } from './providers/stripe.js';
import { UsdcBaseDepositProvider } from './providers/usdc.js';

async function main(): Promise<void> {
  // Load config and services (extended versions that support deposit fields)
  const config = loadDepositConfig();
  const services = loadServicesWithDeposit(process.env.SERVICES_FILE);

  console.log(`Loaded ${services.length} service(s) from services.yaml`);
  for (const s of services) {
    const depositInfo = s.deposit
      ? ` (deposit: $${(s.deposit.amount_cents / 100).toFixed(2)} via ${s.deposit.providers.join(', ')})`
      : '';
    console.log(`  - ${s.name}${depositInfo}`);
  }

  // Collect all deposit provider types needed
  const neededProviders = new Set<string>();
  for (const s of services) {
    if (s.deposit) {
      for (const p of s.deposit.providers) {
        neededProviders.add(p);
      }
    }
  }

  // Initialize deposit providers
  if (neededProviders.has('stripe')) {
    if (!config.stripeSecretKey) {
      throw new Error(
        'STRIPE_SECRET_KEY environment variable is required when any service accepts stripe deposits'
      );
    }
    registerProvider(new StripeDepositProvider(config.stripeSecretKey));
    console.log('Stripe deposit provider initialized');
  }

  if (neededProviders.has('usdc_base')) {
    if (!config.usdcWalletAddress) {
      throw new Error(
        'USDC_WALLET_ADDRESS environment variable is required when any service accepts usdc_base deposits'
      );
    }
    const usdcProvider = new UsdcBaseDepositProvider(
      config.usdcWalletAddress,
      config.baseRpcUrl,
      config.usdcEscrowAddress,
      config.businessPrivateKey
    );
    registerProvider(usdcProvider);
    console.log(
      `USDC (Base L2) deposit provider initialized` +
        (usdcProvider.escrowMode ? ' (escrow mode — deposits are refundable)' : ' (direct transfer mode — deposits are non-refundable)')
    );
  }

  // Validate all service-referenced providers are registered
  for (const s of services) {
    if (s.deposit) {
      for (const p of s.deposit.providers) {
        if (!getRegisteredProviderTypes().includes(p)) {
          throw new Error(
            `Service "${s.name}" references unknown deposit provider "${p}". ` +
              `Registered providers: ${getRegisteredProviderTypes().join(', ') || 'none'}`
          );
        }
      }
    }
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

  // CORS — configurable via CORS_ORIGIN env var (default: all origins)
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN || true,
  });

  // Rate limiting — protect against spam and abuse
  await app.register(rateLimit, {
    global: true,
    max: (request) => {
      // Tighter limit on task creation (10/min) to prevent spam
      if (request.method === 'POST' && request.url === '/tasks') return 10;
      // Standard limit for all other endpoints (100/min)
      return 100;
    },
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
  });

  // Set up webhook notifications (fire-and-forget)
  const notify = createWebhookNotifier(config.webhookUrl);

  // Register routes — deposit-aware version if any service needs deposits
  if (neededProviders.size > 0) {
    registerDepositRoutes(app, config, services, prisma, notify);
  } else {
    registerRoutes(app, config, services, prisma, notify);
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
    if (neededProviders.size > 0) {
      console.log(`  Deposits:   ${Array.from(neededProviders).join(', ')}`);
    }
    if (config.webhookUrl) {
      console.log(`  Webhooks:   ${config.webhookUrl}`);
    }
    console.log('');
  } catch (err) {
    console.error('Failed to start server:', err);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
