import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, resolve } from 'node:path';

const DATA_DIR = resolve(process.cwd(), 'data');
const NODE_FILE = resolve(DATA_DIR, 'node.json');

interface NodeConfig {
  nodeId: string;
  businessApiKey: string;
  indexApiKey?: string;
}

function generateNodeId(): string {
  const input = `${hostname()}-${randomBytes(8).toString('hex')}-${Date.now()}`;
  const hash = createHash('sha256').update(input).digest('hex');
  return hash.slice(0, 6).toLowerCase();
}

function generateApiKey(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString('hex')}`;
}

function loadOrCreateNodeConfig(): NodeConfig {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  if (existsSync(NODE_FILE)) {
    const raw = readFileSync(NODE_FILE, 'utf-8');
    return JSON.parse(raw) as NodeConfig;
  }

  const config: NodeConfig = {
    nodeId: generateNodeId(),
    businessApiKey: generateApiKey('ic_biz'),
  };

  writeFileSync(NODE_FILE, JSON.stringify(config, null, 2), 'utf-8');

  console.log('');
  console.log('=== Inverse Claw Server — First Boot ===');
  console.log(`  Node ID:          ${config.nodeId}`);
  console.log(`  Business API Key: ${config.businessApiKey}`);
  console.log('');
  console.log('  Save your Business API Key — you need it to push task status updates.');
  console.log('  This key is stored locally in data/node.json and is NOT sent to the index.');
  console.log('=========================================');
  console.log('');

  return config;
}

function saveNodeConfig(config: NodeConfig): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  writeFileSync(NODE_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export interface AppConfig {
  nodeId: string;
  businessApiKey: string;
  indexApiKey?: string;
  businessName: string;
  contactEmail: string;
  contactPhone?: string;
  presenceUrls: string[];
  indexEndpoint?: string;
  autoPublish: boolean;
  port: number;
  publicUrl?: string;
  webhookUrl?: string;
}

export function loadConfig(): AppConfig {
  const nodeConfig = loadOrCreateNodeConfig();

  const businessName = process.env.BUSINESS_NAME;
  const contactEmail = process.env.CONTACT_EMAIL;

  if (!businessName) {
    throw new Error('BUSINESS_NAME environment variable is required');
  }
  if (!contactEmail) {
    throw new Error('CONTACT_EMAIL environment variable is required');
  }

  const presenceUrlsRaw = process.env.PRESENCE_URLS ?? '';
  const presenceUrls = presenceUrlsRaw
    .split(',')
    .map((u) => u.trim())
    .filter((u) => u.length > 0);

  const indexApiKey = process.env.INDEX_API_KEY || nodeConfig.indexApiKey;

  return {
    nodeId: nodeConfig.nodeId,
    businessApiKey: nodeConfig.businessApiKey,
    indexApiKey,
    businessName,
    contactEmail,
    contactPhone: process.env.CONTACT_PHONE || undefined,
    presenceUrls,
    indexEndpoint: process.env.INDEX_ENDPOINT || undefined,
    autoPublish: process.env.AUTO_PUBLISH === 'true',
    port: parseInt(process.env.PORT ?? '3000', 10),
    publicUrl: process.env.PUBLIC_URL || undefined,
    webhookUrl: process.env.WEBHOOK_URL || undefined,
  };
}

export { saveNodeConfig };
export type { NodeConfig };

// --- Deposit hold extensions (v1.1) ---

export interface DepositConfig extends AppConfig {
  stripeSecretKey?: string;
  usdcWalletAddress?: string;
  baseRpcUrl?: string;
  gbpUsdRate?: number;
  businessPrivateKey?: string;
  usdcEscrowAddress?: string;
}

export function loadDepositConfig(): DepositConfig {
  const base = loadConfig();
  const rateStr = process.env.GBP_USD_RATE;
  return {
    ...base,
    stripeSecretKey: process.env.STRIPE_SECRET_KEY || undefined,
    usdcWalletAddress: process.env.USDC_WALLET_ADDRESS || undefined,
    baseRpcUrl: process.env.BASE_RPC_URL || undefined,
    gbpUsdRate: rateStr ? parseFloat(rateStr) : undefined,
    businessPrivateKey: process.env.BUSINESS_PRIVATE_KEY || undefined,
    usdcEscrowAddress: process.env.USDC_ESCROW_ADDRESS || undefined,
  };
}
