import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "../../shared/const.js";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { getBusinessOwnerByOpenId } from "../db";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

/**
 * ownerProcedure — for routes that operate on a specific business owner's data.
 *
 * Requires:
 *  1. A valid session (Bearer token or cookie).
 *  2. The `businessOwnerId` in the route input must match the session user's
 *     own business owner record.
 *
 * This prevents cross-owner data access: a logged-in business owner cannot
 * read or mutate another owner's clients, appointments, services, etc.
 *
 * Routes that are genuinely public (OTP, plan listing, referral validation,
 * onboarding create/check) should continue to use `publicProcedure`.
 */
export const ownerProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;

    // 1. Must be authenticated
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }

    // 2. Extract businessOwnerId from the raw input (present on all owner-scoped routes)
    const rawInput = await opts.getRawInput();
    const input = rawInput as Record<string, unknown> | null | undefined;
    const requestedId =
      typeof input?.businessOwnerId === "number" ? input.businessOwnerId : null;

    if (requestedId === null) {
      // No businessOwnerId in input — let the route handler deal with it
      return next({ ctx: { ...ctx, user: ctx.user } });
    }

    // 3. Resolve the session user → their business owner record
    const sessionOwner = await getBusinessOwnerByOpenId(ctx.user.openId);

    if (!sessionOwner) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "No business owner account found for this session.",
      });
    }

    // 4. Enforce ownership: session owner must match the requested owner
    if (sessionOwner.id !== requestedId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You are not authorised to access this business owner's data.",
      });
    }

    return next({ ctx: { ...ctx, user: ctx.user } });
  }),
);
