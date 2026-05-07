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
 */
export function ClientAppLockProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const appLock = useAppLock(
    true,
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
