import "server-only";
import Stripe from "stripe";

let stripeClient: Stripe | null = null;

export function stripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new StripeNotConfiguredError();
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

export class StripeNotConfiguredError extends Error {
  constructor() {
    super("Stripe is not configured. Set STRIPE_SECRET_KEY and the price IDs.");
    this.name = "StripeNotConfiguredError";
  }
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function priceId(kind: "single" | "subscription"): string {
  const id =
    kind === "single"
      ? process.env.STRIPE_PRICE_SINGLE_REPORT
      : process.env.STRIPE_PRICE_PRO_MONTHLY;
  if (!id) throw new StripeNotConfiguredError();
  return id;
}

export function siteUrl(fallbackOrigin: string): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? fallbackOrigin;
}
