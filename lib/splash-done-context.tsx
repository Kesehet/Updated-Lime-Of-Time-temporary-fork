/**
 * SplashDoneContext
 *
 * Exposes the root-level `splashDone` boolean to any child component or
 * nested route layout (e.g. (client-tabs)/_layout.tsx) without prop drilling
 * across the Expo Router file-based routing boundary.
 *
 * Usage:
 *   // In _layout.tsx (root):
 *   <SplashDoneProvider splashDone={splashDone}>...</SplashDoneProvider>
 *
 *   // In any child component / nested layout:
 *   const splashDone = useSplashDone();
 */
import { createContext, useContext } from "react";

const SplashDoneContext = createContext<boolean>(true);

export function SplashDoneProvider({
  children,
  splashDone,
}: {
  children: React.ReactNode;
  splashDone: boolean;
}) {
  return (
    <SplashDoneContext.Provider value={splashDone}>
      {children}
    </SplashDoneContext.Provider>
  );
}

/** Returns true once the animated splash has finished and navigation has committed. */
export function useSplashDone(): boolean {
  return useContext(SplashDoneContext);
}
