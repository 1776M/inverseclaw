import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  encodeFunctionData,
  type Address,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, mainnet, arbitrum, optimism, polygon } from 'viem/chains';
import { randomBytes } from 'node:crypto';
import type { DepositProvider, CreateDepositResult } from '../depositProvider.js';
import { ESCROW_ABI, EscrowStatus } from '../escrowAbi.js';

const USDC_DECIMALS = 6;

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

/** Canonical escrow contract addresses per chain (deployed by the project) */
const ESCROW_ADDRESSES: Record<number, Address> = {
  // Populated after deployment — leave empty until contracts are deployed
};

export interface EvmUsdcConfig {
  /** Chain ID (e.g. 8453 for Base, 1 for Ethereum, 42161 for Arbitrum) */
  chainId: number;
  /** Business wallet address to receive deposits */
  walletAddress: string;
  /** RPC endpoint URL (optional, has defaults for known chains) */
  rpcUrl?: string;
  /** USDC contract address (optional, auto-detected for known chains) */
  usdcAddress?: string;
  /** Provider type identifier (optional, auto-generated as usdc_{chain_name}) */
  providerType?: string;
  /** Escrow contract address (optional, auto-detected for known chains once deployed) */
  escrowAddress?: string;
  /** Business private key for signing capture/release transactions (required for escrow mode) */
  businessPrivateKey?: string;
}

/**
 * EVM USDC deposit provider.
 *
 * Two modes:
 * - **Escrow mode** (recommended): Deposits go to the InverseClawEscrow contract.
 *   Fully refundable. Capture/release are real on-chain transactions.
 *   Requires `escrowAddress` and `businessPrivateKey`.
 *
 * - **Direct transfer mode** (fallback): Deposits go straight to the business wallet.
 *   Non-refundable. Capture/release are no-ops. Used when escrow is not configured.
 *   A warning is logged at startup.
 */
export class EvmUsdcProvider implements DepositProvider {
  readonly type: string;
  readonly escrowMode: boolean;
  private walletAddress: Address;
  private rpcUrl: string;
  private usdcAddress: Address;
  private chainId: number;
  private chain: Chain;
  private escrowAddress: Address | null;
  private businessPrivateKey: string | null;

  /** Track expected USDC amounts per deposit reference */
  private expectedAmounts = new Map<string, bigint>();
  /** Track used tx hashes to prevent replay attacks */
  private usedTxHashes = new Set<string>();
  /** Map deposit reference string → bytes32 hash (for escrow contract calls) */
  private depositIdToBytes32 = new Map<string, `0x${string}`>();

  constructor(config: EvmUsdcConfig) {
    this.chainId = config.chainId;
    this.walletAddress = config.walletAddress as Address;

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

    // Resolve escrow config
    const escrowAddr = config.escrowAddress ?? ESCROW_ADDRESSES[config.chainId];
    this.escrowAddress = escrowAddr ? (escrowAddr as Address) : null;
    this.businessPrivateKey = config.businessPrivateKey ?? null;

    // Determine mode
    this.escrowMode = !!(this.escrowAddress && this.businessPrivateKey);

    if (!this.escrowMode) {
      console.warn(
        `[${this.type}] Running in DIRECT TRANSFER mode (no escrow). ` +
          'Deposits are non-refundable. Set BUSINESS_PRIVATE_KEY and escrow address for refundable deposits.'
      );
    }
  }

  async createDeposit(params: {
    amountCents: number;
    description: string;
    taskId: string;
  }): Promise<CreateDepositResult> {
    const depositReference = `dep_${randomBytes(12).toString('hex')}`;
    const amountUsdc = (params.amountCents / 100).toFixed(2);

    // Store expected amount for verification (USDC has 6 decimals)
    const expectedRaw = Math.round(parseFloat(amountUsdc) * 10 ** USDC_DECIMALS);
    const minimumAmount = BigInt(expectedRaw);
    this.expectedAmounts.set(depositReference, minimumAmount);

    if (this.escrowMode) {
      // Compute bytes32 deposit ID for the contract
      const depositIdBytes32 = keccak256(toHex(depositReference));
      this.depositIdToBytes32.set(depositReference, depositIdBytes32);

      return {
        depositId: depositReference,
        providerType: this.type,
        clientData: {
          mode: 'escrow',
          escrow_address: this.escrowAddress,
          business_wallet: this.walletAddress,
          amount_usdc: amountUsdc,
          chain_id: this.chainId,
          deposit_reference: depositReference,
          deposit_id_bytes32: depositIdBytes32,
          token_address: this.usdcAddress,
        },
      };
    }

    // Direct transfer mode (fallback)
    return {
      depositId: depositReference,
      providerType: this.type,
      clientData: {
        mode: 'direct_transfer',
        wallet_address: this.walletAddress,
        amount_usdc: amountUsdc,
        chain_id: this.chainId,
        deposit_reference: depositReference,
        token_address: this.usdcAddress,
      },
    };
  }

  async confirmDeposit(
    depositId: string,
    confirmation: Record<string, string>
  ): Promise<boolean> {
    const txHash = confirmation.tx_hash;
    if (!txHash) return false;

    // Prevent tx_hash replay — same hash cannot confirm multiple deposits
    const normalizedHash = txHash.toLowerCase();
    if (this.usedTxHashes.has(normalizedHash)) return false;

    // Look up expected minimum amount
    const minimumAmount = this.expectedAmounts.get(depositId) ?? 0n;

    const client = createPublicClient({
      chain: this.chain,
      transport: http(this.rpcUrl),
    });

    try {
      const receipt = await client.getTransactionReceipt({
        hash: txHash as `0x${string}`,
      });

      if (receipt.status !== 'success') return false;

      if (this.escrowMode) {
        return this.confirmEscrowDeposit(receipt.logs, depositId, minimumAmount, normalizedHash);
      }

      return this.confirmDirectTransfer(receipt.logs, depositId, minimumAmount, normalizedHash);
    } catch {
      return false;
    }
  }

  async capture(depositId: string): Promise<void> {
    if (!this.escrowMode) return; // No-op in direct transfer mode

    const depositIdBytes32 = this.depositIdToBytes32.get(depositId);
    if (!depositIdBytes32) throw new Error(`Unknown deposit: ${depositId}`);

    await this.sendEscrowTransaction('capture', depositIdBytes32);
  }

  async release(depositId: string): Promise<void> {
    if (!this.escrowMode) return; // No-op in direct transfer mode

    const depositIdBytes32 = this.depositIdToBytes32.get(depositId);
    if (!depositIdBytes32) throw new Error(`Unknown deposit: ${depositId}`);

    await this.sendEscrowTransaction('release', depositIdBytes32);
  }

  // --- Private helpers ---

  /** Confirm a deposit made via the escrow contract (look for Deposited event) */
  private confirmEscrowDeposit(
    logs: readonly any[],
    depositId: string,
    minimumAmount: bigint,
    normalizedHash: string
  ): boolean {
    const depositIdBytes32 = this.depositIdToBytes32.get(depositId);
    if (!depositIdBytes32) return false;

    // Look for the Deposited event from the escrow contract
    // Deposited(bytes32 indexed depositId, address indexed depositor, address indexed businessWallet, uint256 amount, uint256 expiresAt)
    const escrowAddr = this.escrowAddress!.toLowerCase();

    for (const log of logs) {
      if (log.address.toLowerCase() !== escrowAddr) continue;

      // topics[1] = depositId (indexed bytes32)
      if (!log.topics[1] || log.topics[1].toLowerCase() !== depositIdBytes32.toLowerCase()) continue;

      // Decode amount from data (first 32 bytes = amount, next 32 bytes = expiresAt)
      const amount = BigInt('0x' + log.data.slice(2, 66));
      if (amount >= minimumAmount && amount > 0n) {
        this.usedTxHashes.add(normalizedHash);
        this.expectedAmounts.delete(depositId);
        return true;
      }
    }

    return false;
  }

  /** Confirm a direct USDC transfer to the business wallet */
  private confirmDirectTransfer(
    logs: readonly any[],
    depositId: string,
    minimumAmount: bigint,
    normalizedHash: string
  ): boolean {
    for (const log of logs) {
      if (log.address.toLowerCase() !== this.usdcAddress.toLowerCase()) continue;

      // ERC20 Transfer: topics[2] = to address, data = value
      if (!log.topics[2]) continue;
      const toAddress = ('0x' + log.topics[2].slice(26)).toLowerCase();
      if (toAddress !== this.walletAddress.toLowerCase()) continue;

      const value = BigInt(log.data);
      if (value >= minimumAmount && value > 0n) {
        this.usedTxHashes.add(normalizedHash);
        this.expectedAmounts.delete(depositId);
        return true;
      }
    }

    return false;
  }

  /** Send a capture or release transaction to the escrow contract */
  private async sendEscrowTransaction(
    method: 'capture' | 'release',
    depositIdBytes32: `0x${string}`
  ): Promise<void> {
    const account = privateKeyToAccount(this.businessPrivateKey! as `0x${string}`);

    const walletClient = createWalletClient({
      account,
      chain: this.chain,
      transport: http(this.rpcUrl),
    });

    const hash = await walletClient.writeContract({
      address: this.escrowAddress!,
      abi: ESCROW_ABI,
      functionName: method,
      args: [depositIdBytes32],
    });

    // Wait for confirmation
    const publicClient = createPublicClient({
      chain: this.chain,
      transport: http(this.rpcUrl),
    });

    await publicClient.waitForTransactionReceipt({ hash });
  }

}

/**
 * Convenience factory for Base L2 (the default/recommended chain).
 * Kept for backward compatibility with existing config.
 */
export class UsdcBaseDepositProvider extends EvmUsdcProvider {
  constructor(
    walletAddress: string,
    rpcUrl?: string,
    escrowAddress?: string,
    businessPrivateKey?: string
  ) {
    super({
      chainId: base.id,
      walletAddress,
      rpcUrl,
      providerType: 'usdc_base',
      escrowAddress,
      businessPrivateKey,
    });
  }
}
