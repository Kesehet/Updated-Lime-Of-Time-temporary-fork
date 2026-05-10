/**
 * Web stub for StripeProvider.
 * @stripe/stripe-react-native is native-only and cannot run on web.
 * This file is loaded by Metro on web builds instead of stripe-provider.tsx.
 */
import React from "react";

type StripeProviderProps = {
  publishableKey: string;
  children: React.ReactNode;
  merchantIdentifier?: string;
  urlScheme?: string;
};

export function StripeProvider({ children }: StripeProviderProps) {
  return <>{children}</>;
}
