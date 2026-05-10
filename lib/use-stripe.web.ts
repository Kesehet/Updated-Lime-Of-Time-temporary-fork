/**
 * Web stub for useStripe hook.
 * @stripe/stripe-react-native is native-only and cannot run on web.
 * This file is loaded by Metro on web builds instead of use-stripe.ts.
 */

type PaymentSheetError = { code: string; message: string } | undefined;

export function useStripe() {
  return {
    initPaymentSheet: async (_params: Record<string, unknown>): Promise<{ error: PaymentSheetError }> => ({
      error: { code: "WebNotSupported", message: "Card payments are not supported on web" },
    }),
    presentPaymentSheet: async (): Promise<{ error: PaymentSheetError }> => ({
      error: { code: "WebNotSupported", message: "Card payments are not supported on web" },
    }),
  };
}
