/**
 * Fire-and-forget webhook notifications.
 *
 * When WEBHOOK_URL is configured, the server POSTs a JSON payload on
 * task events. Works with Slack, Zapier, Make, or any HTTP endpoint.
 *
 * Failures are logged but never throw — webhooks must not block the API.
 */

export type WebhookEvent = 'task.created' | 'task.updated' | 'deposit.confirmed';

export type WebhookNotifier = (event: WebhookEvent, data: Record<string, unknown>) => void;

/**
 * Creates a webhook notifier function. If webhookUrl is undefined,
 * returns a no-op. The returned function is synchronous from the
 * caller's perspective — it fires a fetch and catches errors internally.
 */
export function createWebhookNotifier(webhookUrl: string | undefined): WebhookNotifier {
  if (!webhookUrl) return () => {};

  return (event: WebhookEvent, data: Record<string, unknown>): void => {
    const body = JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      data,
    });

    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(5000),
    }).catch((err: Error) => {
      console.error(`[webhook] Failed to notify ${webhookUrl}: ${err.message}`);
    });
  };
}
