import { Platform } from "react-native";
import { getApiBaseUrl } from "@/constants/oauth";
import { logger } from "@/lib/logger";
import * as Auth from "./auth";
import { emitSessionExpired } from "./session-events";

type ApiResponse<T> = {
  data?: T;
  error?: string;
};

export async function apiCall<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  // Determine the auth method:
  // - Native platform: use stored session token as Bearer auth
  // - Web (including iframe): use cookie-based auth (browser handles automatically)
  if (Platform.OS !== "web") {
    const sessionToken = await Auth.getSessionToken();
    logger.log("[API] apiCall:", {
      endpoint,
      hasToken: !!sessionToken,
      method: options.method || "GET",
    });
    if (sessionToken) {
      headers["Authorization"] = `Bearer ${sessionToken}`;
    }
  } else {
    logger.log("[API] apiCall:", { endpoint, platform: "web", method: options.method || "GET" });
  }

  const baseUrl = getApiBaseUrl();
  const cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = baseUrl ? `${cleanBaseUrl}${cleanEndpoint}` : endpoint;
  logger.log("[API] Full URL:", url);

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      credentials: "include",
    });

    logger.log("[API] Response status:", response.status, response.statusText);
    // NOTE: Do NOT use Object.fromEntries(response.headers.entries()) here.
    // Headers.entries() iterator crashes on iOS 26 / Hermes (SIGSEGV in objectFromEntries).
    // Use response.headers.get() for individual headers instead.

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("[API] Error response:", errorText);
      // 401 Unauthorized — session expired or invalid; emit global event
      if (response.status === 401) {
        const isClientEndpoint = endpoint.includes("/client/");
        emitSessionExpired(isClientEndpoint ? "client" : "business");
      }
      let errorMessage = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorJson.message || errorText;
      } catch {
        // Not JSON, use text as is
      }
      throw new Error(errorMessage || `API call failed: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      const data = await response.json();
      logger.log("[API] JSON response received");
      return data as T;
    }

    const text = await response.text();
    logger.log("[API] Text response received");
    return (text ? JSON.parse(text) : {}) as T;
  } catch (error) {
    logger.captureError(error, { endpoint, method: options.method || "GET" });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Unknown error occurred");
  }
}

// OAuth callback handler - exchange code for session token
export async function exchangeOAuthCode(
  code: string,
  state: string,
): Promise<{ sessionToken: string; user: any }> {
  logger.log("[API] exchangeOAuthCode called");
  const params = new URLSearchParams({ code, state });
  const endpoint = `/api/oauth/mobile?${params.toString()}`;
  const result = await apiCall<{ app_session_id: string; user: any }>(endpoint);

  const sessionToken = result.app_session_id;
  logger.log("[API] OAuth exchange result:", {
    hasSessionToken: !!sessionToken,
    hasUser: !!result.user,
  });

  return {
    sessionToken,
    user: result.user,
  };
}

// Logout
export async function logout(): Promise<void> {
  await apiCall<void>("/api/auth/logout", {
    method: "POST",
  });
}

// Get current authenticated user
export async function getMe(): Promise<{
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  lastSignedIn: string;
} | null> {
  try {
    const result = await apiCall<{ user: any }>("/api/auth/me");
    return result.user || null;
  } catch (error) {
    logger.error("[API] getMe failed:", error);
    return null;
  }
}

// Establish session cookie on the backend
export async function establishSession(token: string): Promise<boolean> {
  try {
    logger.log("[API] establishSession: setting cookie on backend...");
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/api/auth/session`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
    });

    if (!response.ok) {
      logger.error("[API] establishSession failed:", response.status);
      return false;
    }

    logger.log("[API] establishSession: cookie set successfully");
    return true;
  } catch (error) {
    logger.captureError(error, { context: "establishSession" });
    return false;
  }
}
