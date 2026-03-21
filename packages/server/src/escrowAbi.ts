/**
 * Minimal ABI for the InverseClawEscrow contract.
 * Only includes the functions and events the server needs to interact with.
 */
export const ESCROW_ABI = [
  {
    type: 'function',
    name: 'release',
    inputs: [{ name: 'depositId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'capture',
    inputs: [{ name: 'depositId', type: 'bytes32' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getDeposit',
    inputs: [{ name: 'depositId', type: 'bytes32' }],
    outputs: [
      { name: 'depositor', type: 'address' },
      { name: 'businessWallet', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'expiresAt', type: 'uint256' },
      { name: 'status', type: 'uint8' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      { name: 'depositId', type: 'bytes32', indexed: true },
      { name: 'depositor', type: 'address', indexed: true },
      { name: 'businessWallet', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'expiresAt', type: 'uint256', indexed: false },
    ],
  },
] as const;

/** Escrow deposit status enum matching the contract */
export const EscrowStatus = {
  None: 0,
  Held: 1,
  Released: 2,
  Captured: 3,
  Expired: 4,
} as const;
