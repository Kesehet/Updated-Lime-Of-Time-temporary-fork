/**
 * StripeKeyContext
 *
 * Provides a way for child screens to update the Stripe publishable key
 * used by the root StripeProvider. This is necessary for Stripe Connect:
 * the key returned by create-payment-sheet must match the key in StripeProvider,
 * but the key can differ between test/live mode or between connected accounts.
 *
 * Usage in a screen:
 *   const { setStripePublishableKey } = useStripeKey();
 *   // After fetching create-payment-sheet:
 *   setStripePublishableKey(sheetData.publishableKey);
 *   await initPaymentSheet({ ... });
 */
import React, { createContext, useContext, useState, useCallback } from "react";

type StripeKeyContextValue = {
  stripePublishableKey: string;
  setStripePublishableKey: (key: string) => void;
};

const StripeKeyContext = createContext<StripeKeyContextValue>({
  stripePublishableKey: "",
  setStripePublishableKey: () => {},
});

export function StripeKeyProvider({ children }: { children: React.ReactNode }) {
  const [stripePublishableKey, setStripePublishableKeyState] = useState("");

  const setStripePublishableKey = useCallback((key: string) => {
    if (key && key !== "pk_test_placeholder") {
      setStripePublishableKeyState(key);
    }
  }, []);

  return (
    <StripeKeyContext.Provider value={{ stripePublishableKey, setStripePublishableKey }}>
      {children}
    </StripeKeyContext.Provider>
  );
}

export function useStripeKey() {
  return useContext(StripeKeyContext);
}
