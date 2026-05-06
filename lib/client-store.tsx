/**
 * Client Portal Store
 *
 * Manages client account state, session, and cached data for the client portal.
 * Completely separate from the business owner store.
 */

import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiBaseUrl } from "@/constants/oauth";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClientAccount {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  profilePhotoUri: string | null;
  avatarUrl: string | null;
  expoPushToken: string | null;
  createdAt: string;
}

export interface ClientAppointment {
  id: number;
  businessOwnerId: number;
  businessName: string;
  businessSlug: string;
  businessLogoUri?: string | null;
  businessCategory?: string | null;
  serviceName: string;
  date: string;
  time: string;
  duration: number;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
  notes: string | null;
  totalPrice: string | null;
  price: number | null;
  staffName: string | null;
  staffAvatarUrl: string | null;
  locationName: string | null;
  locationAddress: string | null;
  cancelRequest?: { status: "pending" | "approved" | "declined"; reason?: string } | null;
  rescheduleRequest?: { status: "pending" | "approved" | "declined"; requestedDate: string; requestedTime: string } | null;
}

export interface ClientMessage {
  id: number;
  appointmentId: number;
  senderType: "client" | "business";
  senderName: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface SavedBusiness {
  id: number;
  businessOwnerId: number;
  businessName: string;
  businessSlug: string;
  businessCategory: string | null;
  businessAddress: string | null;
  businessPhone: string | null;
  savedAt: string;
}

export interface DiscoverBusiness {
  id: number;
  businessName: string;
  slug: string;
  category: string | null;
  address: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  distanceKm: number | null;
  reviewCount: number;
  avgRating: number | null;
  logoUrl: string | null;
  businessLogoUri: string | null;
  description: string | null;
  businessCategory: string | null;
  customSlug: string | null;
}

export interface ClientState {
  loaded: boolean;
  account: ClientAccount | null;
  sessionToken: string | null;
  appointments: ClientAppointment[];
  savedBusinesses: SavedBusiness[];
  unreadMessageCount: number;
  discoverRadius: number; // km
  discoverCategory: string | null;
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

const CLIENT_SESSION_KEY = "client_session_token";
const CLIENT_ACCOUNT_KEY = "client_account_info";
const CLIENT_PROFILE_MODE_KEY = "app_profile_mode"; // "business" | "client"

// ─── Actions ──────────────────────────────────────────────────────────────────

type ClientAction =
  | { type: "LOAD_SESSION"; payload: { account: ClientAccount | null; sessionToken: string | null } }
  | { type: "SET_ACCOUNT"; payload: ClientAccount }
  | { type: "CLEAR_SESSION" }
  | { type: "SET_APPOINTMENTS"; payload: ClientAppointment[] }
  | { type: "SET_SAVED_BUSINESSES"; payload: SavedBusiness[] }
  | { type: "SET_UNREAD_COUNT"; payload: number }
  | { type: "SET_DISCOVER_RADIUS"; payload: number }
  | { type: "SET_DISCOVER_CATEGORY"; payload: string | null }
  | { type: "TOGGLE_SAVE_BUSINESS"; payload: SavedBusiness }
  | { type: "ADD_SAVED_BUSINESS"; payload: SavedBusiness }
  | { type: "REMOVE_SAVED_BUSINESS"; payload: string | number };  // accepts slug or id

// ─── Reducer ──────────────────────────────────────────────────────────────────

const initialState: ClientState = {
  loaded: false,
  account: null,
  sessionToken: null,
  appointments: [],
  savedBusinesses: [],
  unreadMessageCount: 0,
  discoverRadius: 25,
  discoverCategory: null,
};

function clientReducer(state: ClientState, action: ClientAction): ClientState {
  switch (action.type) {
    case "LOAD_SESSION":
      return {
        ...state,
        loaded: true,
        account: action.payload.account,
        sessionToken: action.payload.sessionToken,
      };
    case "SET_ACCOUNT":
      return { ...state, account: action.payload };
    case "CLEAR_SESSION":
      return { ...initialState, loaded: true };
    case "SET_APPOINTMENTS":
      return { ...state, appointments: action.payload };
    case "SET_SAVED_BUSINESSES":
      return { ...state, savedBusinesses: action.payload };
    case "SET_UNREAD_COUNT":
      return { ...state, unreadMessageCount: action.payload };
    case "SET_DISCOVER_RADIUS":
      return { ...state, discoverRadius: action.payload };
    case "SET_DISCOVER_CATEGORY":
      return { ...state, discoverCategory: action.payload };
    case "TOGGLE_SAVE_BUSINESS": {
      const exists = state.savedBusinesses.some(
        (b) => b.businessOwnerId === action.payload.businessOwnerId
      );
      return {
        ...state,
        savedBusinesses: exists
          ? state.savedBusinesses.filter((b) => b.businessOwnerId !== action.payload.businessOwnerId)
          : [...state.savedBusinesses, action.payload],
      };
    }
    case "ADD_SAVED_BUSINESS":
      return {
        ...state,
        savedBusinesses: [...state.savedBusinesses.filter((b) => b.businessSlug !== action.payload.businessSlug), action.payload],
      };
    case "REMOVE_SAVED_BUSINESS":
      return {
        ...state,
        savedBusinesses: state.savedBusinesses.filter(
          (b) => b.id !== action.payload && b.businessSlug !== action.payload
        ),
      };
    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface ClientStoreContextValue {
  state: ClientState;
  dispatch: React.Dispatch<ClientAction>;
  signIn: (account: ClientAccount, token: string) => Promise<void>;
  signOut: () => Promise<void>;
  apiCall: <T>(path: string, options?: RequestInit) => Promise<T>;
}

const ClientStoreContext = createContext<ClientStoreContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ClientStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(clientReducer, initialState);

  // Load persisted session on mount
  useEffect(() => {
    (async () => {
      try {
        const [token, accountJson] = await Promise.all([
          AsyncStorage.getItem(CLIENT_SESSION_KEY),
          AsyncStorage.getItem(CLIENT_ACCOUNT_KEY),
        ]);
        const account = accountJson ? (JSON.parse(accountJson) as ClientAccount) : null;
        dispatch({ type: "LOAD_SESSION", payload: { account, sessionToken: token } });
      } catch {
        dispatch({ type: "LOAD_SESSION", payload: { account: null, sessionToken: null } });
      }
    })();
  }, []);

  const signIn = useCallback(async (account: ClientAccount, token: string) => {
    await Promise.all([
      AsyncStorage.setItem(CLIENT_SESSION_KEY, token),
      AsyncStorage.setItem(CLIENT_ACCOUNT_KEY, JSON.stringify(account)),
    ]);
    dispatch({ type: "SET_ACCOUNT", payload: account });
    dispatch({ type: "LOAD_SESSION", payload: { account, sessionToken: token } });
  }, []);

  const signOut = useCallback(async () => {
    await Promise.all([
      AsyncStorage.removeItem(CLIENT_SESSION_KEY),
      AsyncStorage.removeItem(CLIENT_ACCOUNT_KEY),
    ]);
    dispatch({ type: "CLEAR_SESSION" });
  }, []);

  const apiCall = useCallback(async <T,>(path: string, options?: RequestInit): Promise<T> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options?.headers as Record<string, string>),
    };
    if (state.sessionToken) {
      headers["Authorization"] = `Bearer ${state.sessionToken}`;
    }
    const res = await fetch(`${getApiBaseUrl()}${path}`, { ...options, headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Request failed" }));
      throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }, [state.sessionToken]);

  // ── Background unread-count polling (every 30 s when signed in) ──────────
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!state.sessionToken || !state.account) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    const poll = async () => {
      try {
        const data = await apiCall<{ count: number }>("/api/client/messages/unread-count");
        dispatch({ type: "SET_UNREAD_COUNT", payload: data.count });
      } catch { /* silent */ }
    };
    poll(); // immediate first fetch
    pollRef.current = setInterval(poll, 30_000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [state.sessionToken, state.account, apiCall]);

  return (
    <ClientStoreContext.Provider value={{ state, dispatch, signIn, signOut, apiCall }}>
      {children}
    </ClientStoreContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useClientStore() {
  const ctx = useContext(ClientStoreContext);
  if (!ctx) throw new Error("useClientStore must be used within ClientStoreProvider");
  return ctx;
}

// ─── Profile Mode Helpers ─────────────────────────────────────────────────────

export async function getProfileMode(): Promise<"business" | "client" | null> {
  const val = await AsyncStorage.getItem(CLIENT_PROFILE_MODE_KEY);
  if (val === "business" || val === "client") return val;
  return null;
}

export async function setProfileMode(mode: "business" | "client"): Promise<void> {
  await AsyncStorage.setItem(CLIENT_PROFILE_MODE_KEY, mode);
}

export async function clearProfileMode(): Promise<void> {
  await AsyncStorage.removeItem(CLIENT_PROFILE_MODE_KEY);
}
