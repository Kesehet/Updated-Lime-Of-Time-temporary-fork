import { createContext, useContext } from "react";
import { useAppLock, CLIENT_BIOMETRIC_ENABLED_KEY, recordClientActivity } from "@/hooks/use-app-lock";
import { LockScreen } from "@/components/lock-screen";

type AppLockContextType = {
  isLocked: boolean;
  biometricEnabled: boolean;
  biometricAvailable: boolean;
  biometricType: "face" | "fingerprint" | "none";
  authenticate: () => Promise<boolean>;
  toggleBiometric: (enabled: boolean) => Promise<boolean>;
};

const AppLockContext = createContext<AppLockContextType | null>(null);

/**
 * Business portal app lock provider.
 * splashDone: when false, the Face ID prompt is deferred until the animated
 * splash finishes. Defaults to true (no deferral) so existing usages are safe.
 */
export function AppLockProvider({
  children,
  splashDone = true,
}: {
  children: React.ReactNode;
  splashDone?: boolean;
}) {
  const appLock = useAppLock(splashDone);

  return (
    <AppLockContext.Provider value={appLock}>
      {children}
      {appLock.isLocked && (
        <LockScreen
          biometricType={appLock.biometricType}
          onUnlock={appLock.authenticate}
        />
      )}
    </AppLockContext.Provider>
  );
}

/**
 * Client portal app lock provider.
 * Uses a separate storage key so the client biometric setting is independent
 * from the business owner's biometric setting.
 *
 * splashDone: when false, the Face ID prompt is deferred until the animated
 * splash finishes AND the user has navigated into the client tabs.
 * Pass the root-level splashDone value so the biometric prompt never fires
 * before the user has tapped the Client Portal card on the portal selector.
 */
export function ClientAppLockProvider({
  children,
  splashDone = true,
}: {
  children: React.ReactNode;
  splashDone?: boolean;
}) {
  const appLock = useAppLock(
    splashDone,
    CLIENT_BIOMETRIC_ENABLED_KEY,
    recordClientActivity, // resets the 24h timer after successful Face ID
  );

  return (
    <AppLockContext.Provider value={appLock}>
      {children}
      {appLock.isLocked && (
        <LockScreen
          biometricType={appLock.biometricType}
          onUnlock={appLock.authenticate}
        />
      )}
    </AppLockContext.Provider>
  );
}

export function useAppLockContext(): AppLockContextType {
  const ctx = useContext(AppLockContext);
  if (!ctx) {
    throw new Error("useAppLockContext must be used within AppLockProvider");
  }
  return ctx;
}

/**
 * Safe version of useAppLockContext that returns a no-op fallback instead of
 * throwing when the provider has been unmounted (e.g. during navigation away).
 * Use this in screens that may briefly render after their provider unmounts.
 */
const FALLBACK_LOCK_CTX: AppLockContextType = {
  isLocked: false,
  biometricEnabled: false,
  biometricAvailable: false,
  biometricType: "none",
  authenticate: async () => false,
  toggleBiometric: async () => false,
};
export function useAppLockContextSafe(): AppLockContextType {
  return useContext(AppLockContext) ?? FALLBACK_LOCK_CTX;
}
