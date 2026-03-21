import Stripe from 'stripe';

let stripeClient: Stripe | null = null;

export function initStripe(secretKey: string): void {
  stripeClient = new Stripe(secretKey);
}

export function getStripe(): Stripe {
  if (!stripeClient) throw new Error('Stripe not initialized — set STRIPE_SECRET_KEY');
  return stripeClient;
}

export async function createDepositHold(
  amountPence: number,
  description: string
): Promise<{ paymentIntentId: string; clientSecret: string }> {
  const stripe = getStripe();
  const intent = await stripe.paymentIntents.create({
    amount: amountPence,
    currency: 'gbp',
    capture_method: 'manual', // pre-auth hold, not immediate charge
    description,
  });
  return {
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret!,
  };
}

export async function captureDeposit(paymentIntentId: string): Promise<void> {
  const stripe = getStripe();
  await stripe.paymentIntents.capture(paymentIntentId);
}

export async function releaseDeposit(paymentIntentId: string): Promise<void> {
  const stripe = getStripe();
  await stripe.paymentIntents.cancel(paymentIntentId);
}
