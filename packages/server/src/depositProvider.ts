/**
 * Deposit provider interface and registry.
 *
 * Providers implement this interface to handle deposit holds for
 * different payment methods. The server is provider-agnostic — it
 * delegates to whichever provider(s) the business has configured.
 *
 * Built-in providers: Stripe (card holds), USDC on Base (crypto).
 * Open source — anyone can add more by implementing this interface.
 */

export interface CreateDepositResult {
  /** Provider's unique ID for this deposit */
  depositId: string;
  /** Provider type identifier (e.g. 'stripe', 'usdc_base') */
  providerType: string;
  /** Provider-specific data the agent needs to complete the deposit */
  clientData: Record<string, unknown>;
}

export interface DepositProvider {
  /** Unique identifier for this provider type */
  readonly type: string;

  /**
   * Create a deposit requirement and return what the agent needs
   * to complete it on the customer's side.
   */
  createDeposit(params: {
    amountPence: number;
    description: string;
    taskId: string;
  }): Promise<CreateDepositResult>;

  /**
   * Verify the agent's deposit confirmation.
   * Returns true if the deposit is confirmed.
   */
  confirmDeposit(
    depositId: string,
    confirmation: Record<string, string>
  ): Promise<boolean>;

  /** Capture the deposit (business keeps funds — e.g. no-show) */
  capture(depositId: string): Promise<void>;

  /** Release the deposit (funds returned to customer — e.g. job completed) */
  release(depositId: string): Promise<void>;
}

// --- Provider registry ---

const providers = new Map<string, DepositProvider>();

export function registerProvider(provider: DepositProvider): void {
  providers.set(provider.type, provider);
}

export function getProvider(type: string): DepositProvider {
  const p = providers.get(type);
  if (!p) throw new Error(`Unknown deposit provider: "${type}"`);
  return p;
}

export function getRegisteredProviderTypes(): string[] {
  return Array.from(providers.keys());
}

export function clearProviders(): void {
  providers.clear();
}
