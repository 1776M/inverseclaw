import Stripe from 'stripe';
import type { DepositProvider, CreateDepositResult } from '../depositProvider.js';

export class StripeDepositProvider implements DepositProvider {
  readonly type = 'stripe';
  private stripe: Stripe;

  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey);
  }

  async createDeposit(params: {
    amountCents: number;
    description: string;
    taskId: string;
  }): Promise<CreateDepositResult> {
    const intent = await this.stripe.paymentIntents.create({
      amount: params.amountCents,
      currency: 'usd',
      capture_method: 'manual', // pre-auth hold, not immediate charge
      description: params.description,
    });

    return {
      depositId: intent.id,
      providerType: 'stripe',
      clientData: { client_secret: intent.client_secret },
    };
  }

  async confirmDeposit(
    depositId: string,
    confirmation: Record<string, string>
  ): Promise<boolean> {
    if (confirmation.payment_intent_id !== depositId) return false;

    // Verify with Stripe that the hold actually succeeded
    const intent = await this.stripe.paymentIntents.retrieve(depositId);
    return intent.status === 'requires_capture';
  }

  async capture(depositId: string): Promise<void> {
    await this.stripe.paymentIntents.capture(depositId);
  }

  async release(depositId: string): Promise<void> {
    await this.stripe.paymentIntents.cancel(depositId);
  }
}
