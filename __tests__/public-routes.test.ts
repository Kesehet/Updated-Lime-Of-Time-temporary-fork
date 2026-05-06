import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const projectRoot = path.resolve(__dirname, "..");

describe("Public Routes - File Structure", () => {
  it("publicRoutes.ts should exist in server directory", () => {
    const filePath = path.join(projectRoot, "server", "publicRoutes.ts");
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("server index.ts should import and register public routes", () => {
    const content = fs.readFileSync(
      path.join(projectRoot, "server", "_core", "index.ts"),
      "utf-8"
    );
    expect(content).toContain('import { registerPublicRoutes } from "../publicRoutes"');
    expect(content).toContain("registerPublicRoutes(app)");
  });
});

describe("Public Routes - API Endpoints", () => {
  const content = fs.readFileSync(
    path.join(projectRoot, "server", "publicRoutes.ts"),
    "utf-8"
  );

  it("should have GET /api/public/business/:slug endpoint", () => {
    expect(content).toContain('app.get("/api/public/business/:slug"');
  });

  it("should have GET /api/public/business/:slug/services endpoint", () => {
    expect(content).toContain('app.get("/api/public/business/:slug/services"');
  });

  it("should have GET /api/public/business/:slug/slots endpoint", () => {
    expect(content).toContain('app.get("/api/public/business/:slug/slots"');
  });

  it("should have GET /api/public/business/:slug/discounts endpoint", () => {
    expect(content).toContain('app.get("/api/public/business/:slug/discounts"');
  });

  it("should have GET /api/public/business/:slug/reviews endpoint", () => {
    expect(content).toContain('app.get("/api/public/business/:slug/reviews"');
  });

  it("should have GET /api/public/gift/:code endpoint", () => {
    expect(content).toContain('app.get("/api/public/gift/:code"');
  });

  it("should have POST /api/public/business/:slug/book endpoint", () => {
    expect(content).toContain('app.post("/api/public/business/:slug/book"');
  });

  it("should have POST /api/public/business/:slug/review endpoint", () => {
    expect(content).toContain('app.post("/api/public/business/:slug/review"');
  });
});

describe("Public Routes - HTML Pages", () => {
  const content = fs.readFileSync(
    path.join(projectRoot, "server", "publicRoutes.ts"),
    "utf-8"
  );

  it("should serve booking page at GET /api/book/:slug", () => {
    expect(content).toContain('app.get("/api/book/:slug"');
  });

  it("should serve review page at GET /api/review/:slug", () => {
    expect(content).toContain('app.get("/api/review/:slug"');
  });

  it("should serve gift card page at GET /api/gift/:code", () => {
    expect(content).toContain('app.get("/api/gift/:code"');
  });

  it("should serve homepage at GET /api/home", () => {
    expect(content).toContain('app.get("/api/home"');
  });
});

describe("Public Routes - Booking Page Features", () => {
  const content = fs.readFileSync(
    path.join(projectRoot, "server", "publicRoutes.ts"),
    "utf-8"
  );

  it("booking page should have client info step (name, phone, email)", () => {
    expect(content).toContain("clientName");
    expect(content).toContain("clientPhone");
    expect(content).toContain("clientEmail");
  });

  it("booking page should have service selection step", () => {
    expect(content).toContain("serviceList");
    expect(content).toContain("selectService");
  });

  it("booking page should have date and time selection step", () => {
    expect(content).toContain("calGrid");
    expect(content).toContain("timeGrid");
    expect(content).toContain("selectDate");
    expect(content).toContain("selectTime");
  });

  it("booking page should have confirmation step", () => {
    expect(content).toContain("confirmDetails");
    expect(content).toContain("submitBooking");
  });

  it("booking page should have success step", () => {
    expect(content).toContain("Booking Submitted");
    expect(content).toContain("Book Another");
  });

  it("booking page should support gift codes", () => {
    expect(content).toContain("giftCode");
    expect(content).toContain("applyGiftCode");
  });

  it("booking page should show discount information", () => {
    expect(content).toContain("discountInfo");
    expect(content).toContain("checkDiscount");
  });

  it("booking page should show business info", () => {
    expect(content).toContain("biz-card");
    expect(content).toContain("maps.google.com");
  });

  it("booking page should handle temporarily closed businesses", () => {
    expect(content).toContain("temporaryClosed");
    expect(content).toContain("temporarily closed");
  });
});

describe("Public Routes - Review Page Features", () => {
  const content = fs.readFileSync(
    path.join(projectRoot, "server", "publicRoutes.ts"),
    "utf-8"
  );

  it("review page should display existing reviews", () => {
    expect(content).toContain("reviewsList");
    expect(content).toContain("loadReviews");
  });

  it("review page should have star rating", () => {
    expect(content).toContain("starRating");
    expect(content).toContain("setRating");
  });

  it("review page should have review submission form", () => {
    expect(content).toContain("submitReview");
    expect(content).toContain("reviewerName");
    expect(content).toContain("reviewComment");
  });

  it("review page should show success after submission", () => {
    expect(content).toContain("reviewSuccess");
    expect(content).toContain("Thank You");
  });
});

describe("Public Routes - Gift Card Page Features", () => {
  const content = fs.readFileSync(
    path.join(projectRoot, "server", "publicRoutes.ts"),
    "utf-8"
  );

  it("gift card page should load gift card details", () => {
    expect(content).toContain("loadGift");
    expect(content).toContain("giftDetails");
  });

  it("gift card page should show redemption status", () => {
    expect(content).toContain("redeemed");
    expect(content).toContain("giftStatus");
  });

  it("gift card page should have book now link", () => {
    expect(content).toContain("bookLink");
    expect(content).toContain("Book Now");
  });

  it("gift card page should show error for invalid codes", () => {
    expect(content).toContain("giftError");
    expect(content).toContain("Gift Card Not Found");
  });
});

describe("Public Routes - Booking API Validation", () => {
  const content = fs.readFileSync(
    path.join(projectRoot, "server", "publicRoutes.ts"),
    "utf-8"
  );

  it("booking API should validate required fields", () => {
    expect(content).toContain("Missing required fields");
  });

  it("booking API should check for temporarily closed business", () => {
    expect(content).toContain("Business is temporarily closed");
  });

  it("booking API should verify time slot availability", () => {
    expect(content).toContain("Selected time slot is no longer available");
  });

  it("booking API should handle existing clients by phone", () => {
    expect(content).toContain("getClientByPhone");
  });

  it("booking API should create appointment with pending status", () => {
    expect(content).toContain('"pending"');
    expect(content).toContain("createAppointment");
  });

  it("booking API should handle gift card redemption", () => {
    expect(content).toContain("getGiftCardByCode");
    // atomicDeductGiftCardBalance replaced updateGiftCard for atomic balance deduction
    expect(content).toContain("atomicDeductGiftCardBalance");
  });
});

describe("Database - getBusinessOwnerBySlug", () => {
  const content = fs.readFileSync(
    path.join(projectRoot, "server", "db.ts"),
    "utf-8"
  );

  it("should have getBusinessOwnerBySlug function", () => {
    expect(content).toContain("export async function getBusinessOwnerBySlug");
  });

  it("should convert business name to slug for matching", () => {
    expect(content).toContain('toLowerCase().replace(/\\s+/g, "-")');
  });
});

describe("Public Routes - Lime Of Time Branding", () => {
  const content = fs.readFileSync(
    path.join(projectRoot, "server", "publicRoutes.ts"),
    "utf-8"
  );

  it("should include Lime Of Time branding", () => {
    expect(content).toContain("Lime Of Time");
  });

  it("should have proper meta viewport for mobile", () => {
    expect(content).toContain("viewport");
    expect(content).toContain("width=device-width");
  });

  it("should use green color scheme matching the app", () => {
    expect(content).toContain("#4a8c3f");
    expect(content).toContain("#2d5a27");
  });
});
