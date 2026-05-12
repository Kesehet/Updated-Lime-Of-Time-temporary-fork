import { createContext, useContext } from "react";
import { useAppLock, CLIENT_BIOMETRIC_ENABLED_KEY, CLIENT_LAST_ACTIVE_KEY, CLIENT_REAUTH_MS, recordClientActivity } from "@/hooks/use-app-lock";
import { LockScreen } from "@/components/lock-screen";
import { useStore } from "@/lib/store";

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
 * Reads businessName and businessLogoUri from the store so the lock screen
 * shows the business branding above "App Locked".
 */
export function AppLockProvider({
  children,
  splashDone = true,
}: {
  children: React.ReactNode;
  splashDone?: boolean;
}) {
  const appLock = useAppLock(splashDone);
  const { state } = useStore();

  const businessName = state.settings.businessName || undefined;
  const logoUri = state.settings.businessLogoUri || undefined;

  return (
    <AppLockContext.Provider value={appLock}>
      {children}
      {appLock.isLocked && (
        <LockScreen
          biometricType={appLock.biometricType}
          onUnlock={appLock.authenticate}
          businessName={businessName}
          logoUri={logoUri}
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
  splashDone = true,
}: {
  children: React.ReactNode;
  splashDone?: boolean;
}) {
  const appLock = useAppLock(
    splashDone,
    CLIENT_BIOMETRIC_ENABLED_KEY,
    recordClientActivity, // resets the 24h timer after successful Face ID
    CLIENT_LAST_ACTIVE_KEY,
    CLIENT_REAUTH_MS,
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
