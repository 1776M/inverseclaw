/**
 * Tests for EvmStablecoinProvider — USDC and USDT token support.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('viem', () => ({
  createPublicClient: vi.fn(),
  createWalletClient: vi.fn(),
  http: vi.fn(),
  keccak256: vi.fn().mockReturnValue('0xmockhash'),
  toHex: vi.fn().mockImplementation((v: string) => `0x${Buffer.from(v).toString('hex')}`),
  encodeFunctionData: vi.fn(),
}));

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn().mockReturnValue({ address: '0xmock' }),
}));

vi.mock('viem/chains', () => ({
  base: { id: 8453, name: 'Base' },
  mainnet: { id: 1, name: 'Ethereum' },
  arbitrum: { id: 42161, name: 'Arbitrum One' },
  optimism: { id: 10, name: 'OP Mainnet' },
  polygon: { id: 137, name: 'Polygon' },
}));

import { EvmStablecoinProvider, UsdcBaseDepositProvider, UsdtBaseDepositProvider } from '../src/providers/usdc.js';

describe('EvmStablecoinProvider — token selection', () => {
  it('should default to USDC', () => {
    const provider = new EvmStablecoinProvider({
      chainId: 8453,
      walletAddress: '0xabc',
    });
    expect(provider.type).toBe('usdc_base');
  });

  it('should support USDT', () => {
    const provider = new EvmStablecoinProvider({
      chainId: 8453,
      walletAddress: '0xabc',
      token: 'usdt',
    });
    expect(provider.type).toBe('usdt_base');
  });

  it('should auto-generate provider type from token and chain', () => {
    const provider = new EvmStablecoinProvider({
      chainId: 42161,
      walletAddress: '0xabc',
      token: 'usdt',
    });
    expect(provider.type).toBe('usdt_arbitrum_one');
  });

  it('should allow custom provider type override', () => {
    const provider = new EvmStablecoinProvider({
      chainId: 8453,
      walletAddress: '0xabc',
      token: 'usdt',
      providerType: 'my_custom_usdt',
    });
    expect(provider.type).toBe('my_custom_usdt');
  });
});

describe('Convenience classes', () => {
  it('UsdcBaseDepositProvider should create usdc_base', () => {
    const provider = new UsdcBaseDepositProvider('0xabc');
    expect(provider.type).toBe('usdc_base');
  });

  it('UsdtBaseDepositProvider should create usdt_base', () => {
    const provider = new UsdtBaseDepositProvider('0xabc');
    expect(provider.type).toBe('usdt_base');
  });
});

describe('createDeposit — token field', () => {
  it('USDC deposit should include token: usdc', async () => {
    const provider = new UsdcBaseDepositProvider('0xabc');
    const result = await provider.createDeposit({
      amountCents: 1500,
      description: 'Test deposit',
      taskId: 'tsk_test',
    });
    expect(result.clientData.token).toBe('usdc');
    expect(result.clientData.amount).toBe('15.00');
  });

  it('USDT deposit should include token: usdt', async () => {
    const provider = new UsdtBaseDepositProvider('0xabc');
    const result = await provider.createDeposit({
      amountCents: 2000,
      description: 'Test deposit',
      taskId: 'tsk_test',
    });
    expect(result.clientData.token).toBe('usdt');
    expect(result.clientData.amount).toBe('20.00');
  });

  it('deposit amount should be USD cents / 100', async () => {
    const provider = new UsdcBaseDepositProvider('0xabc');
    const result = await provider.createDeposit({
      amountCents: 999,
      description: 'Test',
      taskId: 'tsk_test',
    });
    expect(result.clientData.amount).toBe('9.99');
  });
});

describe('Known token addresses', () => {
  it('should resolve USDC on all pre-configured chains', () => {
    for (const chainId of [8453, 1, 42161, 10, 137]) {
      expect(() => new EvmStablecoinProvider({
        chainId,
        walletAddress: '0xabc',
        token: 'usdc',
      })).not.toThrow();
    }
  });

  it('should resolve USDT on all pre-configured chains', () => {
    for (const chainId of [8453, 1, 42161, 10, 137]) {
      expect(() => new EvmStablecoinProvider({
        chainId,
        walletAddress: '0xabc',
        token: 'usdt',
      })).not.toThrow();
    }
  });

  it('should throw for unknown chain without tokenAddress', () => {
    expect(() => new EvmStablecoinProvider({
      chainId: 99999,
      walletAddress: '0xabc',
      token: 'usdc',
      rpcUrl: 'https://example.com',
    })).toThrow('No known USDC address');
  });

  it('should accept custom tokenAddress for unknown chain', () => {
    expect(() => new EvmStablecoinProvider({
      chainId: 99999,
      walletAddress: '0xabc',
      token: 'usdc',
      tokenAddress: '0xcustom',
      rpcUrl: 'https://example.com',
    })).not.toThrow();
  });
});
