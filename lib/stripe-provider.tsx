/**
 * Native StripeProvider — wraps children with the real StripeProvider from @stripe/stripe-react-native.
 * On web, Metro will load stripe-provider.web.tsx instead (no native imports).
 */
import { StripeProvider as NativeStripeProvider } from "@stripe/stripe-react-native";
import React from "react";

type StripeProviderProps = {
  publishableKey: string;
  children: React.ReactNode;
  merchantIdentifier?: string;
  urlScheme?: string;
};

export function StripeProvider({ children, publishableKey, merchantIdentifier, urlScheme }: StripeProviderProps) {
  return (
    <NativeStripeProvider
      publishableKey={publishableKey}
      merchantIdentifier={merchantIdentifier}
      urlScheme={urlScheme}
    >
      {children as React.ReactElement}
    </NativeStripeProvider>
  );
}
