/**
 * Tests for the 24h business re-auth and 30-day client inactivity helpers.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock AsyncStorage ──────────────────────────────────────────────────────────
const store: Record<string, string> = {};
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => store[key] ?? null),
    setItem: vi.fn(async (key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn(async (key: string) => { delete store[key]; }),
    multiRemove: vi.fn(async (keys: string[]) => { keys.forEach((k) => delete store[k]); }),
  },
}));

// ── Mock Platform ──────────────────────────────────────────────────────────────
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));

// ── Mock expo-local-authentication ─────────────────────────────────────────────
vi.mock("expo-local-authentication", () => ({
  hasHardwareAsync: vi.fn(async () => true),
  isEnrolledAsync: vi.fn(async () => true),
  supportedAuthenticationTypesAsync: vi.fn(async () => [2]),
  AuthenticationType: { FACIAL_RECOGNITION: 2, FINGERPRINT: 1 },
  authenticateAsync: vi.fn(async () => ({ success: true })),
}));

import {
  recordBusinessActivity,
  recordClientActivity,
  businessNeedsReauth,
  clientNeedsLogout,
  BUSINESS_LAST_ACTIVE_KEY,
  CLIENT_LAST_ACTIVE_KEY,
  BUSINESS_REAUTH_MS,
  CLIENT_INACTIVITY_LOGOUT_MS,
} from "../hooks/use-app-lock";

// We need to export BUSINESS_REAUTH_MS and CLIENT_INACTIVITY_LOGOUT_MS for testing
// They are defined in the module — import them directly

describe("businessNeedsReauth", () => {
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
  });

  it("returns false when no last-active timestamp exists (first launch)", async () => {
    expect(await businessNeedsReauth()).toBe(false);
  });

  it("returns false when last activity was less than 24 hours ago", async () => {
    store[BUSINESS_LAST_ACTIVE_KEY] = (Date.now() - 1 * 60 * 60 * 1000).toString(); // 1 hour ago
    expect(await businessNeedsReauth()).toBe(false);
  });

  it("returns true when last activity was more than 24 hours ago", async () => {
    store[BUSINESS_LAST_ACTIVE_KEY] = (Date.now() - 25 * 60 * 60 * 1000).toString(); // 25 hours ago
    expect(await businessNeedsReauth()).toBe(true);
  });

  it("recordBusinessActivity resets the timer so businessNeedsReauth returns false", async () => {
    store[BUSINESS_LAST_ACTIVE_KEY] = (Date.now() - 25 * 60 * 60 * 1000).toString(); // was 25h ago
    await recordBusinessActivity(); // reset
    expect(await businessNeedsReauth()).toBe(false);
  });
});

describe("clientNeedsLogout", () => {
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
  });

  it("returns false when no last-active timestamp exists (first launch)", async () => {
    expect(await clientNeedsLogout()).toBe(false);
  });

  it("returns false when last activity was less than 30 days ago", async () => {
    store[CLIENT_LAST_ACTIVE_KEY] = (Date.now() - 5 * 24 * 60 * 60 * 1000).toString(); // 5 days ago
    expect(await clientNeedsLogout()).toBe(false);
  });

  it("returns true when last activity was more than 30 days ago", async () => {
    store[CLIENT_LAST_ACTIVE_KEY] = (Date.now() - 31 * 24 * 60 * 60 * 1000).toString(); // 31 days ago
    expect(await clientNeedsLogout()).toBe(true);
  });

  it("recordClientActivity resets the timer so clientNeedsLogout returns false", async () => {
    store[CLIENT_LAST_ACTIVE_KEY] = (Date.now() - 31 * 24 * 60 * 60 * 1000).toString(); // was 31d ago
    await recordClientActivity(); // reset
    expect(await clientNeedsLogout()).toBe(false);
  });
});
