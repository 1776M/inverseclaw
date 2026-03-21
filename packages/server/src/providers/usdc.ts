import { createPublicClient, http, type Address, type Chain } from 'viem';
import { base, mainnet, arbitrum, optimism, polygon } from 'viem/chains';
import { randomBytes } from 'node:crypto';
import type { DepositProvider, CreateDepositResult } from '../depositProvider.js';

const USDC_DECIMALS = 6;

/** Default GBP to USD rate. Override with GBP_USD_RATE env var. */
const DEFAULT_GBP_USD_RATE = 1.27;

/** Known USDC contract addresses per chain ID */
const USDC_ADDRESSES: Record<number, Address> = {
  [base.id]:     '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',  // Base
  [mainnet.id]:  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',  // Ethereum
  [arbitrum.id]: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // Arbitrum
  [optimism.id]: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',  // Optimism
  [polygon.id]:  '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',  // Polygon
};

/** Known chain objects by ID for viem */
const CHAIN_OBJECTS: Record<number, Chain> = {
  [base.id]:     base,
  [mainnet.id]:  mainnet,
  [arbitrum.id]: arbitrum,
  [optimism.id]: optimism,
  [polygon.id]:  polygon,
};

/** Default RPC URLs per chain */
const DEFAULT_RPC_URLS: Record<number, string> = {
  [base.id]:     'https://mainnet.base.org',
  [mainnet.id]:  'https://eth.llamarpc.com',
  [arbitrum.id]: 'https://arb1.arbitrum.io/rpc',
  [optimism.id]: 'https://mainnet.optimism.io',
  [polygon.id]:  'https://polygon-rpc.com',
};

export interface EvmUsdcConfig {
  /** Chain ID (e.g. 8453 for Base, 1 for Ethereum, 42161 for Arbitrum) */
  chainId: number;
  /** Business wallet address to receive deposits */
  walletAddress: string;
  /** RPC endpoint URL (optional, has defaults for known chains) */
  rpcUrl?: string;
  /** GBP to USD conversion rate (optional, default 1.27) */
  gbpUsdRate?: number;
  /** USDC contract address (optional, auto-detected for known chains) */
  usdcAddress?: string;
  /** Provider type identifier (optional, auto-generated as usdc_{chain_name}) */
  providerType?: string;
}

/**
 * EVM USDC deposit provider.
 *
 * Works on any EVM chain with USDC. Pre-configured for Base, Ethereum,
 * Arbitrum, Optimism, and Polygon. Custom chains can be added by
 * providing the chain ID, USDC address, and RPC URL.
 *
 * Usage:
 *   new EvmUsdcProvider({ chainId: 8453, walletAddress: '0x...' })  // Base
 *   new EvmUsdcProvider({ chainId: 42161, walletAddress: '0x...' }) // Arbitrum
 *   new EvmUsdcProvider({ chainId: 1, walletAddress: '0x...' })     // Ethereum
 */
export class EvmUsdcProvider implements DepositProvider {
  readonly type: string;
  private walletAddress: Address;
  private rpcUrl: string;
  private gbpUsdRate: number;
  private usdcAddress: Address;
  private chainId: number;
  private chain: Chain;

  constructor(config: EvmUsdcConfig) {
    this.chainId = config.chainId;
    this.walletAddress = config.walletAddress as Address;
    this.gbpUsdRate = config.gbpUsdRate ?? DEFAULT_GBP_USD_RATE;

    // Resolve chain object
    const chain = CHAIN_OBJECTS[config.chainId];
    if (!chain && !config.rpcUrl) {
      throw new Error(
        `Unknown chain ID ${config.chainId}. Provide rpcUrl for custom chains.`
      );
    }
    this.chain = chain ?? { id: config.chainId, name: `Chain ${config.chainId}` } as Chain;

    // Resolve USDC address
    const usdcAddr = config.usdcAddress ?? USDC_ADDRESSES[config.chainId];
    if (!usdcAddr) {
      throw new Error(
        `No known USDC address for chain ID ${config.chainId}. Provide usdcAddress.`
      );
    }
    this.usdcAddress = usdcAddr as Address;

    // Resolve RPC URL
    this.rpcUrl = config.rpcUrl ?? DEFAULT_RPC_URLS[config.chainId] ?? '';

    // Resolve provider type name
    this.type = config.providerType ?? `usdc_${(this.chain.name ?? String(config.chainId)).toLowerCase().replace(/\s+/g, '_')}`;
  }

  async createDeposit(params: {
    amountPence: number;
    description: string;
    taskId: string;
  }): Promise<CreateDepositResult> {
    const depositReference = `dep_${randomBytes(12).toString('hex')}`;
    const amountUsdc = this.penceToUsdc(params.amountPence);

    return {
      depositId: depositReference,
      providerType: this.type,
      clientData: {
        wallet_address: this.walletAddress,
        amount_usdc: amountUsdc,
        chain_id: this.chainId,
        deposit_reference: depositReference,
        token_address: this.usdcAddress,
      },
    };
  }

  async confirmDeposit(
    _depositId: string,
    confirmation: Record<string, string>
  ): Promise<boolean> {
    const txHash = confirmation.tx_hash;
    if (!txHash) return false;

    const client = createPublicClient({
      chain: this.chain,
      transport: http(this.rpcUrl),
    });

    try {
      const receipt = await client.getTransactionReceipt({
        hash: txHash as `0x${string}`,
      });

      if (receipt.status !== 'success') return false;

      // Check for USDC Transfer event to our wallet
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== this.usdcAddress.toLowerCase()) continue;

        // ERC20 Transfer: topics[2] = to address, data = value
        if (!log.topics[2]) continue;
        const toAddress = ('0x' + log.topics[2].slice(26)).toLowerCase();
        if (toAddress !== this.walletAddress.toLowerCase()) continue;

        const value = BigInt(log.data);
        if (value > 0n) return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  async capture(_depositId: string): Promise<void> {
    // No-op: funds were sent directly to the business wallet.
  }

  async release(_depositId: string): Promise<void> {
    // Direct transfer model — refund is at the business's discretion.
  }

  private penceToUsdc(pence: number): string {
    const gbp = pence / 100;
    const usd = gbp * this.gbpUsdRate;
    return usd.toFixed(2);
  }
}

/**
 * Convenience factory for Base L2 (the default/recommended chain).
 * Kept for backward compatibility with existing config.
 */
export class UsdcBaseDepositProvider extends EvmUsdcProvider {
  constructor(walletAddress: string, rpcUrl?: string, gbpUsdRate?: number) {
    super({
      chainId: base.id,
      walletAddress,
      rpcUrl,
      gbpUsdRate,
      providerType: 'usdc_base',
    });
  }
}
