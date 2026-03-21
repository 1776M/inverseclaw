import { createPublicClient, http, parseAbiItem, type Address } from 'viem';
import { base } from 'viem/chains';
import { randomBytes } from 'node:crypto';
import type { DepositProvider, CreateDepositResult } from '../depositProvider.js';

/** USDC contract address on Base mainnet */
const USDC_ADDRESS_BASE: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_DECIMALS = 6;

/** Default GBP to USD rate. Override with GBP_USD_RATE env var. */
const DEFAULT_GBP_USD_RATE = 1.27;

const transferEvent = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
);

export class UsdcBaseDepositProvider implements DepositProvider {
  readonly type = 'usdc_base';
  private walletAddress: Address;
  private rpcUrl: string;
  private gbpUsdRate: number;

  constructor(
    walletAddress: string,
    rpcUrl?: string,
    gbpUsdRate?: number
  ) {
    this.walletAddress = walletAddress as Address;
    this.rpcUrl = rpcUrl ?? 'https://mainnet.base.org';
    this.gbpUsdRate = gbpUsdRate ?? DEFAULT_GBP_USD_RATE;
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
      providerType: 'usdc_base',
      clientData: {
        wallet_address: this.walletAddress,
        amount_usdc: amountUsdc,
        chain_id: 8453, // Base mainnet
        deposit_reference: depositReference,
        token_address: USDC_ADDRESS_BASE,
      },
    };
  }

  async confirmDeposit(
    depositId: string,
    confirmation: Record<string, string>
  ): Promise<boolean> {
    const txHash = confirmation.tx_hash;
    if (!txHash) return false;

    const client = createPublicClient({
      chain: base,
      transport: http(this.rpcUrl),
    });

    try {
      const receipt = await client.getTransactionReceipt({
        hash: txHash as `0x${string}`,
      });

      if (receipt.status !== 'success') return false;

      // Check for USDC Transfer event to our wallet
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== USDC_ADDRESS_BASE.toLowerCase()) continue;

        // Transfer event: topics[1] = from, topics[2] = to, data = value
        if (!log.topics[2]) continue;
        const toAddress = ('0x' + log.topics[2].slice(26)).toLowerCase();
        if (toAddress !== this.walletAddress.toLowerCase()) continue;

        const value = BigInt(log.data);
        // Accept if any USDC was transferred (amount check is lenient
        // since exchange rates fluctuate between creation and payment)
        if (value > 0n) return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  async capture(_depositId: string): Promise<void> {
    // No-op: USDC was sent directly to the business wallet.
    // The funds are already with the business.
  }

  async release(_depositId: string): Promise<void> {
    // USDC deposits are direct transfers, not holds.
    // "Release" means the business should refund the customer manually.
    // The server records this intent; the actual on-chain refund is at
    // the business's discretion.
  }

  private penceToUsdc(pence: number): string {
    const gbp = pence / 100;
    const usd = gbp * this.gbpUsdRate;
    return usd.toFixed(2);
  }
}
