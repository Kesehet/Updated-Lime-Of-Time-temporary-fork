# Project TODO

- [x] Update theme colors to match design.md brand palette
- [x] Set up icon mappings for all tabs
- [x] Create data models and state management (services, clients, appointments)
- [x] Build tab navigation (Home, Calendar, Clients, Services, Settings)
- [x] Build Dashboard/Home screen with today's appointments and stats
- [x] Build Calendar screen with month view and day appointment list
- [x] Build Clients screen with search and list
- [x] Build Client Detail screen with history and notes
- [x] Build Services screen with list
- [x] Build Add/Edit Service screen
- [x] Build New Booking flow (3-step modal)
- [x] Build Appointment Detail screen
- [x] Build Settings screen with business profile and working hours
- [x] Generate custom app icon
- [x] Final polish and delivery
- [x] Rebrand app to "Lime Of Time" with user's lime-clock logo
- [x] Update theme colors to lime green palette matching the logo
- [x] Fix responsive alignment for all screen sizes
- [x] Add "Send Booking Link" button to share with clients
- [x] Build public booking page accessible via shared link
- [x] Add business profile section in Settings (name, phone, email, address, description)
- [x] Add pending appointment status for client-booked appointments
- [x] Add accept/reject workflow with SMS message generation
- [x] Add contact list import to Clients page
- [x] Build 4 clickable analytics slides on Home (Total Clients, Total Appointments, Total Revenue, Top Service)
- [x] Build analytics detail screens for each slide
- [x] Add calendar filters: Upcoming, Requests, Cancelled, Completed
- [x] Add colored status dots on calendar days
- [x] Add background logo watermark
- [x] Add theme mode toggle in Settings
- [x] Fix responsive alignment for all device resolutions
- [x] Fix time validation: prevent selecting past times for same-day bookings
- [x] Fix appointment duration: end time = start time + service duration (e.g. 9AM + 1hr = 10AM)
- [x] Add sign-up page with phone number entry
- [x] Add business info page after sign-up (name, address, phone, optional email/website, description)
- [x] Wire sign-up business info to Settings profile
- [x] Remove dashboard background logo watermark
- [x] Add client messaging with auto-generated appointment messages (date, time, company, service)
- [x] Message button opens phone SMS with pre-filled message and client phone number
- [x] Add scrolling time picker for working hours selection
- [x] Prevent double-booking: accepted appointment times should be unavailable to other clients
- [x] Add cancellation fee policy controlled by business owner (2-hour window)
- [x] Make calendar green status dots darker green
- [x] Add logout tab in Settings
- [x] Add delete business tab in Settings
- [x] Add temporary closed toggle in Settings connected to scheduling
- [x] Add review system connected to client page
- [x] Use limeoftime.com for public client pages (reviews and booking)
- [x] Fix contact import to select individual contacts instead of bulk import
- [x] Add business name/logo to dashboard header
- [x] Allow user to upload custom business logo image
- [x] Replace logo everywhere with new attached image, remove white background
- [x] Fix contact picker: list hidden by keyboard, show list on top
- [x] Fix contact picker: results from top not bottom, hide keyboard until search bar tapped
- [x] Fix any existing errors in the app
- [x] Add report generator for tax/year-end with all data (revenue, clients, appointments, services)
- [x] Reports accessible from each dashboard analytics slide
- [x] Fix contact picker: properly request permissions and show phone contacts list
- [x] Phone number format: (000) 000-0000
- [x] Settings address: click opens maps showing location on device
- [x] Working hours: control by specific working days via calendar, select time per day
- [x] Calendar: previous days should not be selectable
- [x] Service name: show duration at end e.g. "Hair Cut (20 min)"
- [x] Allow multiple same services with different timing and price
- [x] Fix shared booking link: use limeoftime.com/book/business-name with full business info
- [x] Shared link page: show business name, address, services with duration, calendar with only available upcoming times
- [x] Accept appointment: share full address with map link (e.g. 4661 McKnight Road, Pittsburgh PA, 15237)
- [x] All messages: professional format with full business info, address, service, date, time
- [x] Address in messages: clickable map link for clients
- [x] Connect database - design and implement DB schema for all entities
- [x] Create tRPC API routes for business owner CRUD
- [x] Create tRPC API routes for clients CRUD (linked to business owner)
- [x] Create tRPC API routes for services CRUD (linked to business owner)
- [x] Create tRPC API routes for appointments CRUD (linked to business owner)
- [x] Create tRPC API routes for reviews CRUD (linked to business owner)
- [x] Create tRPC API routes for business settings/profile
- [x] Connect frontend store to database via tRPC
- [x] Implement auth flow - check DB for existing business owner on app launch
- [x] Route to onboarding if no business owner, home if exists
- [x] Ensure all client data is linked to specific business owner
- [x] Write tests for database connections and API routes
- [x] Fix client data not saving to DB - add syncToDb to clients.tsx
- [x] Add discount system - time-based discounts for specific durations
- [x] Add discount DB schema and tRPC routes
- [x] Add discount UI in services/settings
- [x] Add gift card system - shareable service gifts for clients
- [x] Add gift card DB schema and tRPC routes
- [x] Add gift card UI - create, share, redeem
- [x] Add professional dashboard charts (revenue, appointments, clients)
- [x] Add per-day working hours/schedule control with calendar
- [x] Working days calendar - select specific days and set custom hours
- [x] Integrate working days with DB and client-side booking
- [x] Closed days should block booking on client side
- [x] Fix dashboard layout alignment - charts, stats cards, quick actions properly aligned
- [x] Fix text fields and buttons alignment across all screens and resolutions
- [x] Fix responsive layout for all device sizes - consistent padding, margins, widths
- [x] Fix quick actions section alignment on dashboard
- [x] Fix form inputs alignment on onboarding, booking, settings screens
- [x] Fix Discounts page alignment to match Settings/Calendar/Home quality
- [x] Fix Gift Cards page alignment to match Settings/Calendar/Home quality
- [x] Fix Book an Appointment pages alignment to match Settings/Calendar/Home quality
- [x] Update discount system to use calendar date selection instead of day-of-week
- [x] Discount date picker: only allow future dates, not past ones
- [x] Integrate date-based discounts into booking flow and DB
- [x] Fix phone number formatting - +1 numbers should save as +1 (888) 888-8888 not (188) 888-8888
- [x] Fix custom days calendar alignment in Settings working hours
- [x] Add gift card sharing - business owner sends to client via SMS
- [x] Add gift card redemption on client web booking page
- [x] Make booking days unselectable when no available time slots exist
- [x] Release cancelled appointment time slots for rebooking by other clients
- [x] Change all limeoftime.com references to lime-of-time.com
- [x] Ensure backend serves public booking/review web pages for lime-of-time.com
- [x] Verify public web routes work correctly from server
- [x] Create /book/[slug] route for public booking URL
- [x] Create /review/[slug] route for public review URL
- [x] Create /gift/[code] route for gift card redemption URL
- [x] Add review link to confirmation and accept SMS messages
- [x] Add gift card URL to SMS sharing
- [x] Fix EAS build configuration error for publishing
- [x] Fix Android build minSdkVersion from 22 to 24
- [x] Fix Android EAS build minSdkVersion 22 error - expo-build-properties plugin not applied during cloud build
- [x] Add public REST API endpoints for booking data (business info, services, slots, submit appointment)
- [x] Build standalone HTML booking page served by Express server
- [x] Build standalone HTML review page served by Express server
- [x] Build standalone HTML gift card redemption page served by Express server
- [x] Client can select service, day, time, enter name and submit appointment request via web
- [x] Business owner receives appointment request in the app from web bookings
- [x] Provide DNS setup instructions for lime-of-time.com
- [x] Fix public web routes not being served on Manus deployment (book/review/gift pages return Not Found)
- [x] Issue 1: Fix resolution and responsive layout issues across the entire app (especially on iOS after closing/reopening)
- [x] Issue 2: Ensure consistent resolution handling on all pages (no shifting, clipping, scaling, or broken alignment)
- [x] Issue 3: Fix pages only functioning after opening Client Info — Discount, Gift, New Service pages should work from initial app launch
- [x] Issue 4: Fix system theme synchronization — app should update live when device switches between Light/Dark mode
- [x] Issue 5: Fix link reliability — shared booking links work inconsistently
- [x] Issue 6: Add Face ID login support for authentication
- [x] Issue 7: Implement logout and Face ID re-auth flow — business owner logged out on app close, Face ID prompt on reopen
- [x] Issue 8: Enhance splash screen with app logo for polished first impression
- [x] Issue 9: Improve Home Page UI — modernize charts with better graph presentation and readability
- [x] Issue 10: Validate all outgoing/shared links (lime-of-time.com/book, /gift, /review) route correctly every time
- [x] Fix Face ID functionality not working properly
- [x] Fix header overlap/layout on modal pages (Edit Service shows Chrome/back button overlapping title, Save button cut off)
- [x] Fix revenue trend chart not showing money numbers
- [x] Fix Discounts and Gifts not showing data until switching pages and coming back to dashboard
- [x] Fix URL/link routing issue for lime-of-time.com
- [x] Fix double /api prefix in generated links (e.g. /api/api/book/slug) — deployment proxy already adds /api
- [x] Remove Face ID toggle from Settings page
- [x] Fix header overlap on New Service, Gift Cards, and Discounts pages (titles and buttons hidden)
- [x] Fix Face ID logic — stops locking in a loop on every foreground event
- [x] Add Face ID option to onboarding/start page
- [x] Fix client booking calendar to match business working days/hours and custom schedule
- [x] Client calendar should display current month/year like business side
- [x] Non-working days should not be selectable on client booking calendar
- [x] Add Products model (DB schema, store, tRPC routes) for business products
- [x] Add Products management UI in Services tab
- [x] Add multi-service/product selection with "Add More" on client booking page
- [x] Update total appointment time when multiple services selected
- [x] Add "Save Receipt" button to booking confirmation
- [x] Receipt should show all selected services, products, pricing, and total
- [x] Fix duplicate client prevention with phone number normalization
- [x] Auto-update client name when same phone submits new request with different name
- [x] Connect all changes to public HTML booking page served by Express
- [x] Fix client booking calendar: days with no available time slots should be disabled/unselectable
- [x] Add green dot indicator on days that have available time slots
- [x] Ensure monthly calendar with month/year header and prev/next month navigation works on deployed version
- [x] Past days should not be selectable, only future available days
- [x] Add "Add More" button on confirm step so client can add services/products before final submit
- [x] Receipt on success page should show all added services, products, total price, total time, and download button
- [x] Fix client booking page Continue button not advancing to next step
- [x] Add Products selection to New Booking page for business user
- [x] Add multiple services and products selection to Gift Cards page
- [x] Add services and products selection to Discounts page (discount can apply to services, products, or both)
- [x] Ensure Products are fully integrated across all app sections
- [x] Add schedule mode switch to Settings (Weekly Hours vs Custom Days)
- [x] Only one schedule mode active at a time, switchable anytime
- [x] When Weekly Hours mode is on, booking uses fixed weekly schedule (e.g. Mon-Fri 8-5)
- [x] When Custom Days mode is on, booking uses per-day custom schedule
- [x] Connect schedule mode to public booking page slot generation
- [x] Fix loadWorkingDays JS function not setting global variables (workingDays/schedMode undefined)
- [x] Fix working-days API returning all days false when business has weekly hours configured (case mismatch: DB stores lowercase day names, code checked capitalized names)
- [x] Fix client booking page (public HTML) calendar not showing available days when Weekly Hours mode is selected (works in-app but not on web)
- [x] Fix revenue calculation: extra items (multi-service/product bookings) not adding to total income and weekly income properly
- [x] Fix business-side appointment detail: show full itemized charges (services, products, prices) not just in notes
- [x] Fix Face ID: after initial enable, auto-login without re-asking every time user opens app (added toggle to Settings, cold-start-only prompt)
- [x] Fix gift card: extra services added by client beyond the gift should be charged (gift only covers what was shared)
- [x] Gift link page: add Copy button for gift code string to paste in booking page gift field
- [x] Gift link: auto-fill gift code when client clicks shared link (pre-populate gift field on booking page)
- [x] Push notifications: send real-time notification to business owner phone when client submits appointment request
- [x] Remove "Map:" line from SMS acceptance message (keep Location line, remove raw URL)
- [x] Fix charges calculation: appointment detail should show full total (service + extras + products - gift - discount), not just base service price
- [x] Ensure income/revenue analytics reflect full charged amount including extras, gift deductions, and discounts across entire app
- [x] Redesign gift card to support monetary balance (sum of selected services/products)
- [x] Gift card creation: allow selecting multiple services and products
- [x] Gift card balance tracking: deduct from balance on each use, allow reuse until balance is $0
- [x] Client booking page: pre-select gifted services/products when gift code applied
- [x] Client booking page: deduct gift balance from total, charge remainder
- [x] In-app booking: support gift balance deduction and partial use
- [x] Server-side: update gift balance after each booking use
- [x] Appointment detail and analytics: show gift deduction correctly with balance-based gifts
- [x] Fix gift card page money calculation broken after balance-based redesign (fixed: server GIFT_DATA parsing, giftUsedAmount tracking, old card fallback, appointment detail deduction display)
- [x] Pre-fill client name and phone number on review page when client opens review link from SMS (already implemented: SMS includes ?name=&phone= params, review page reads and pre-fills)
- [x] Integrate Resend email service for branded appointment notifications from noreply@lime-of-time.com
- [x] Design branded HTML email template with Lime Of Time logo
- [x] Send email notification to business owner when client submits booking request
- [x] Remove Map line from SMS messages (accept, reminder, follow-up) and replace with booking link
- [x] Remove old Manus notification email for new booking requests — only use branded Resend email from lime-of-time.com
- [x] Enable push notification to business owner when new appointment request is submitted (app notification only, no email)

## Phase: Free Features Implementation (33 items)

### Admin Dashboard
- [x] Build admin dashboard with login (username/password from env vars)
- [x] Admin overview: total businesses, clients, appointments, revenue stats
- [x] Admin business management: view/edit/delete all businesses
- [x] Admin client management: view all clients across businesses
- [x] Admin appointment management: view/filter all appointments
- [x] Admin DB explorer: view/query all tables
- [x] Admin settings: manage admin credentials, feature flags
- [x] Admin analytics: user growth, appointment trends, geographic distribution

### Legal Protection
- [x] Generate Privacy Policy page (accessible from app Settings and booking page)
- [x] Generate Terms of Service page (linked from onboarding and booking page)
- [x] Generate End User License Agreement page
- [x] Add client consent checkbox on booking page with timestamp/IP logging
- [x] Generate Business Owner Agreement shown during onboarding
- [x] Add cookie consent banner on booking page
- [x] Add data deletion request feature in app Settings

### Booking Page Improvements
- [x] Display business logo on booking page
- [x] Add SEO meta tags and Open Graph to booking page
- [x] Add dark mode support to booking page
- [x] Add skeleton loading states to booking page
- [x] Improve booking page accessibility (WCAG compliance)

### Core App Features
- [x] Client self-service cancel/reschedule from booking link
- [x] Recurring/repeat appointments
- [x] Revenue analytics dashboard improvements
- [x] Waitlist for fully booked slots
- [x] Client notes and history improvements
- [x] Buffer time between appointments
- [x] Intake forms / pre-appointment questionnaire
- [x] Service categories and grouping
- [x] Blocked dates / holidays management
- [x] Custom booking slug
- [x] Export data (CSV/PDF)
- [x] Onboarding tutorial / walkthrough

### Notifications
- [x] Rich push notifications with appointment details

## Phase: Staff Management + Discount Fix + Admin Integration

### Staff/Team Management
- [x] Add staff DB schema (name, phone, email, role, services, schedule)
- [x] Add staff tRPC routes (CRUD operations)
- [x] Add staff to app store and types
- [x] Build staff management UI screen (add/edit/remove staff)
- [x] Staff service assignments (which staff can perform which services)
- [x] Staff individual schedules (working hours per staff member)
- [x] Integrate staff into booking flow (select staff when booking)
- [x] Show staff on calendar views

### Discount Fix
- [x] Fix discount calculation on client booking page checkout (100% off = $0 total)
- [x] Show discount breakdown on booking confirmation/receipt
- [x] Ensure discount applies correctly to multi-service bookings

### Admin Dashboard Integration
- [x] Add staff management section to admin dashboard
- [x] Add staff to business detail page in admin
- [x] Add staff count to admin dashboard overview
- [x] Ensure all new data visible in admin DB explorer (staff_members table added)

## Phase: PDF Export, Reviews, Cancel/Reschedule, Staff Booking, Staff Calendar

### PDF Export
- [x] Replace CSV export with professional PDF document generation
- [x] PDF should include business branding, formatted tables, and clean layout

### Reviews in Business Settings
- [x] Add reviews section to business settings/profile screen
- [x] Reviews are read-only (business cannot delete client reviews)
- [x] Display star ratings, client name, date, and review text

### Cancel/Reschedule Improvements
- [x] Auto-populate client phone number on manage appointment page
- [x] Pending appointments: client can only cancel (no reschedule option)
- [x] Accepted appointments: client can request reschedule
- [x] Reschedule only allowed 24+ hours before appointment time
- [x] Business acceptance SMS must include reschedule link at the end
- [x] Acceptance message must include client's approved message text

### Staff Selection in Client Booking
- [x] Show staff member selection step in client booking page
- [x] Filter available time slots based on selected staff member's schedule
- [x] Include selected staff name in booking confirmation

### Staff Calendar View
- [x] Build per-staff calendar view screen for business owners
- [x] Show individual staff member appointments on their calendar
- [x] Timeline and calendar view modes with stats

## Phase: Multi-Location Management + Remaining Items

### Multi-Location Management
- [x] Add locations DB schema (name, address, phone, email, working hours per location)
- [x] Add locations tRPC routes (CRUD operations)
- [x] Add locations to app store and types
- [x] Build location management UI screen (add/edit/remove locations)
- [ ] Each location has its own separate staff assignments
- [ ] Each location has its own separate scheduling/working hours
- [ ] Each location has its own separate services and pricing
- [ ] Location selector on dashboard — switch between locations to view stats
- [ ] Location-specific booking links (e.g. lime-of-time.com/book/business/location)
- [ ] Client booking page shows location selector when business has multiple locations
- [ ] Location-specific calendar view for business owner
- [ ] Location-specific analytics and revenue tracking
- [ ] Admin dashboard integration — view all locations per business

### Remaining Staff Items
- [x] Integrate staff into in-app booking flow (select staff when creating appointment from app)
- [x] Show staff assignments on main calendar view (color-coded by staff member)

## Phase: Multi-Location, Staff Fixes, Settings Restructure, Bug Fixes

### Bug Fixes
- [x] Fix phone number matching for cancel/reschedule (auto-filled phone shows mismatch error)
- [x] Fix charges/discount display in app — total charges from client must show correctly
- [x] Fix discount calculation accuracy across the entire app

### Settings Restructure
- [x] Move Reviews to a separate screen (not inside Settings)
- [x] Move Data Export to a separate screen
- [x] Move Staff Management to a separate screen (already done)
- [x] Move Discounts/Gift Cards to separate screens (already done)
- [x] Simplify Settings to only show core business settings
- [x] Create a "More" or organized navigation for all sub-features

### Multi-Location Management
- [x] Add locations DB schema (name, address, phone, email, working hours per location)
- [x] Add locations tRPC routes (CRUD operations)
- [x] Add locations to app store and types
- [x] Build location management UI screen (add/edit/remove locations)
- [ ] Each location has its own separate staff assignments
- [ ] Each location has its own separate scheduling/working hours
- [ ] Each location has its own separate services and pricing
- [ ] Location selector on dashboard — switch between locations to view stats
- [ ] Location-specific booking links
- [ ] Client booking page shows location selector when business has multiple locations
- [ ] Location-specific calendar view for business owner
- [ ] Location-specific analytics and revenue tracking
- [ ] Admin dashboard integration — view all locations per business

### Remaining Staff Items
- [x] Integrate staff into in-app booking flow (select staff when creating appointment from app)
- [x] Show staff assignments on main calendar view (color-coded by staff member)

## Phase: Multi-Location Deep Integration + Categories + Brands + Fixes + Admin Redesign

### Service Categories Integration
- [x] Add service categories to all service selection UIs (discounts, gift cards, appointment creation, client booking)
- [x] Group services by category in selection lists with collapsible headers
- [x] Ensure categories work in business-side new booking service picker
- [x] Ensure categories work in client-side web booking service picker
- [x] Ensure categories work in discount creation service picker
- [x] Ensure categories work in gift card creation service picker

### Product Brands
- [x] Add brand field to Product type and DB schema
- [x] Add brand input to product creation/edit form
- [x] Group products by brand in all product selection UIs
- [x] Ensure brands work in business-side new booking product picker
- [x] Ensure brands work in client-side web booking product picker
- [x] Ensure brands work in gift card creation product picker

### Cancellation Fee Visibility
- [x] Show cancellation fee policy on client booking page before appointment submission
- [x] Show cancellation fee warning when client cancels within the restricted time window
- [x] Display cancellation policy as a link/notice on the client-facing pages

### Discount Fixes
- [x] Fix day-specific percentage discounts not visible on client booking page
- [x] Add discount application to business-side new booking flow (apply active discounts when creating appointment from app)
- [x] Ensure discount breakdown shows correctly in all booking confirmation views

### Multi-Location Deep Integration
- [x] Wire location-specific staff assignments (staff linked to locations)
- [x] Wire location-specific scheduling/working hours into booking slot generation
- [x] Wire location-specific services and pricing
- [x] Add location selector/switcher on dashboard to filter stats by location
- [x] Create location-specific booking links (lime-of-time.com/book/business/location)
- [x] Add location selector to client booking page when business has multiple locations
- [x] Add location filter to calendar view for business owner
- [x] Add location-specific analytics and revenue tracking
- [x] Add locations to admin dashboard — view all locations per business

### Phone/Tablet Responsive Design
- [x] Optimize all app screens for tablet landscape and portrait modes
- [x] Ensure consistent padding, font sizes, and layout on both phone and tablet resolutions
- [x] Test and fix dashboard, calendar, settings, booking screens for tablet

### Admin Dashboard Redesign
- [x] Separate businesses into individual detail views instead of combined lists
- [x] Each business card/page shows all its data (clients, appointments, services, staff, locations, revenue)
- [x] Update admin dashboard logo to Lime Of Time logo (attached image)
- [x] Improve admin dashboard navigation and information hierarchy

## Phase: Notification Fixes — Business Name + Deep Navigation

### Notification Sender Name
- [x] Replace generic titles with business name in all push notification titles (server-side notifyOwner calls)
- [x] Use business name in local reminder notification titles instead of generic text

### Notification Tap Navigation (Deep Linking)
- [x] Add notification response listener (addNotificationResponseReceivedListener) to handle taps
- [x] Handle getLastNotificationResponseAsync for cold-start notification taps
- [x] Include navigation data (type, appointmentId, screen) in all notification payloads
- [x] New booking request notification tap → navigate to appointment-detail with the requested appointment
- [x] Appointment cancelled notification tap → navigate to appointment-detail
- [x] Appointment rescheduled notification tap → navigate to appointment-detail
- [x] 30-min reminder notification tap → navigate to appointment-detail with appointment info
- [x] 1-hour reminder notification tap → navigate to appointment-detail with appointment info
- [x] Waitlist notification tap → navigate to calendar/requests view

## Phase: SMS + Booking Link Fixes

- [x] Fix SMS not sending after confirming a booking from the app (regression)
- [x] Fix booking link missing /api/ prefix — should be /api/book/slug not /book/slug
- [x] Verify public client booking web page works properly for all businesses
- [x] Fix booking page JavaScript syntax error caused by unescaped quotes in selectLocation onclick handler
- [x] Fix manage page slot button quote escaping for selectSlot onclick handler

## Phase: Admin Dashboard Delete Functionality

- [x] Cascade delete business — deleting a business removes all related data (clients, appointments, services, staff, locations, discounts, gift cards, reviews, products, working days, notifications)
- [x] Add individual delete buttons on admin Clients page
- [x] Add individual delete buttons on admin Appointments page
- [x] Add individual delete buttons on admin Services page
- [x] Add individual delete buttons on admin Staff page
- [x] Add individual delete buttons on admin Locations page
- [x] Add individual delete buttons on admin Discounts page
- [x] Add individual delete buttons on admin Gift Cards page
- [x] Add individual delete buttons on admin Reviews page
- [x] Add individual delete buttons on admin Products page
- [x] Add confirmation dialog before any delete action
- [x] Ensure all delete APIs are protected by admin auth


## Phase: Unified Availability Management System Implementation

### Phase 1: Database Schema
- [ ] Create dailyOverrides table
- [ ] Create staffAvailability table
- [ ] Add multiStaffMode column to businessOwners
- [ ] Add staffId and locationId columns to appointments
- [ ] Create indexes for performance
- [ ] Write migration scripts with rollback capability

### Phase 2: Availability Logic Layer
- [ ] Create lib/availability.ts with core functions
- [ ] Implement getAvailableHours() function
- [ ] Implement isDateTimeAvailable() function
- [ ] Implement getAvailableTimeSlots() function
- [ ] Add fallback logic for backward compatibility
- [ ] Write unit tests for availability logic

### Phase 3: TimePickerWheel Component
- [ ] Create components/ui/time-picker-wheel.tsx
- [ ] Implement 12-hour format with AM/PM
- [ ] Support flexible minute selection
- [ ] Add scrolling wheel interaction
- [ ] Test on mobile and web
- [ ] Write component tests

### Phase 4: Business Hours Refactor
- [ ] Rename "Custom Working Hours" to "Business Hours"
- [ ] Redesign Business Hours screen
- [ ] Integrate TimePickerWheel
- [ ] Add preset templates (9-5 Mon-Fri, etc.)
- [ ] Add "Apply to all days" button
- [ ] Update store and API routes

### Phase 5: Calendar Daily Overrides
- [ ] Add right panel to Calendar screen
- [ ] Implement Work Day toggle
- [ ] Add time pickers for daily override
- [ ] Add visual feedback (grayed out, badges)
- [ ] Add conflict detection
- [ ] Sync to database

### Phase 6: Staff Calendar
- [ ] Create Staff Calendar screen
- [ ] Add Multi-Staff Mode toggle to Settings
- [ ] Implement staff availability assignment
- [ ] Integrate with availability logic
- [ ] Add staff conflict detection
- [ ] Update calendar to show staff view

### Phase 7: Data Migration
- [ ] Extract daily overrides from workingHours
- [ ] Extract staff availability from staffMembers
- [ ] Update multi-staff mode flags
- [ ] Enhance appointments with staffId
- [ ] Validate all migrated data
- [ ] Create migration validation report

### Phase 8: Comprehensive Testing
- [ ] Unit tests for availability logic (20+ test cases)
- [ ] Unit tests for TimePickerWheel component
- [ ] Integration tests for booking flow
- [ ] Regression tests for existing features
- [ ] E2E tests for calendar
- [ ] E2E tests for new booking flow
- [ ] Performance tests
- [ ] Mobile and web compatibility tests

### Phase 9: Final Validation & Deployment
- [ ] Run full test suite
- [ ] Verify no breaking changes
- [ ] Test rollback procedure
- [ ] Create deployment checklist
- [ ] Document all changes
- [ ] Save checkpoint


## Phase: Unified Availability Management System

### Phase 1-2: Foundation & Schema (COMPLETED)
- [x] Create database migration script for new tables (dailyOverrides, staffAvailability)
- [x] Implement backward compatibility layer
- [x] Add multiStaffMode flag to businessOwners
- [x] Add optional staffId, locationId to appointments

### Phase 3: TimePickerWheel Component (COMPLETED)
- [x] Create TimePickerWheel component with scrolling wheel interface
- [x] Implement SimpleTimePicker for quick adjustments
- [x] Support 12-hour and 24-hour formats
- [x] Add haptic feedback on selection

### Phase 4: Availability Logic Layer (COMPLETED)
- [x] Create availability.ts with core functions
- [x] Implement three-tier availability checking
- [x] Create 38 comprehensive unit/integration/E2E tests
- [x] All tests passing (343 total tests passing)

### Phase 5: Business Hours UI Refactor (COMPLETED)
- [x] Create business-hours-settings.tsx screen
- [x] Add weekly schedule editor with day toggles
- [x] Implement daily override management
- [x] Add multi-staff mode toggle

### Phase 6: Staff Calendar Enhancement (COMPLETED)
- [x] Verify existing staff-calendar.tsx has all required features
- [x] Staff availability override management exists

### Phase 7: Data Migration (PENDING)
- [ ] Create migration script to populate new tables
- [ ] Validate data integrity
- [ ] Test rollback procedures

### Phase 8: Comprehensive Testing (COMPLETED)
- [x] Unit tests for all availability functions (38 tests)
- [x] Integration tests with booking system
- [x] All 343 tests passing

### Phase 9: Final Delivery (IN PROGRESS)
- [ ] Code review and cleanup
- [ ] Save final checkpoint
- [ ] Deploy to production
- [x] Add per-day Workday override toggle in calendar (ON = available, OFF = blocked)
- [x] Add time range picker per day when Workday is ON (within Business Hours)
- [x] Persist dailyOverrides to customSchedule table in database
- [x] Build reusable ScrollWheelTimePicker (12-hour, AM/PM, flexible minutes)
- [x] Replace all time inputs app-wide with ScrollWheelTimePicker (schedule-settings, staff-form, discounts)
- [x] Add Day view to calendar (appointment timeline like staff-calendar)
- [x] Add Week view to calendar (7-column layout with appointment slots)
- [x] Wire dailyOverrides into new-booking.tsx booking flow (already integrated via customSchedule)
- [x] Wire dailyOverrides into public booking server-side availability (already integrated via customSchedule)
- [x] Fix Edit Hours save not persisting custom time override in Workday panel
- [x] Restrict ScrollWheelTimePicker items to Business Hours range only
- [x] Show Start and End time pickers side-by-side horizontally
- [x] Fix ScrollWheelTimePicker scroll animation lag
- [x] Rebuild Week view: standard weekly navigation, past days disabled, today first and highlighted
- [x] Add Workday switches per day column in Week view
- [x] Add day timeline for selected day in Week view
- [x] Add Business Hours Active Until toggle + date picker in settings
- [x] Replace time inputs with ScrollWheelTimePicker in business-hours-settings.tsx (via schedule-settings.tsx)
- [x] Replace time inputs with ScrollWheelTimePicker in new-booking.tsx (uses slot chips, not text input)
- [x] Wire businessHoursEndDate into calendar and booking to block dates after expiry
- [x] Redesign Week view: horizontal ScrollView, today first, each day = header + Workday switch + full timeline (same as Day view)
- [x] Fix ScrollWheelTimePicker: AM/PM column clipping, proper column widths
- [x] Fix ScrollWheelTimePicker: min/max bounds correctly restrict visible items (not just onChange)
- [x] Fix calendar Workday modal: correct Business Hours bounds passed to pickers
- [x] Fix saved custom hours override Business Hours in all booking flows
- [x] Apply consistent layout fixes to schedule-settings.tsx time picker modal
- [ ] Add end time validation error in calendar.tsx Workday modal (end must be after start)
- [ ] Add end time validation error in schedule-settings.tsx weekly and custom-date modals
- [ ] Add end time validation error in staff-form.tsx and discounts.tsx modals

## Multi-Location & Staff Management

- [ ] Staff form: add multi-location selector (toggle per location); auto-assign when single location (hidden)
- [ ] Location form: replace custom schedule toggle with always-visible Business Hours section using TapTimePicker
- [ ] Public staff API: expose locationIds in response so booking page can filter by location
- [ ] Client booking page: filter staff list to only those assigned to the selected location
- [ ] Staff calendar: constrain available hours to assigned location's business hours (fallback to global)
- [ ] Main calendar: show location filter tabs when multi-location exists
- [ ] Single-location: hide all location UI when only 1 location exists

## Multi-Location & Staff Integration Gaps (Audit Apr 11)
- [x] Fix staff API: use s.workingHours (not s.schedule) when returning staff to booking page
- [x] Fix staff API: use s.active (not s.isActive) for filtering active staff
- [x] Fix /slots endpoint: accept optional staffLocalId + locationLocalId query params; use most specific schedule (staff > location > global)
- [x] Fix booking page loadSlots: pass selectedStaff.localId + selectedLocation when fetching slots
- [ ] Fix booking page checkDayAvailability: pass selectedStaff.localId + selectedLocation when checking day availability
- [ ] Fix booking page isWorkingDay: use selected location's workingHours when a location is selected
- [x] Fix booking page: clear slotCache when staff or location changes
- [x] Fix locations API: include workingHours in response so booking page can use per-location hours
- [ ] Staff list screen: show location assignments (when multi-location) and per-day workday summary


## Multi-Location & Staff Integration Gaps (Audit Apr 11)
- [x] Fix staff API: use s.workingHours (not s.schedule) when returning staff to booking page
- [x] Fix staff API: use s.active (not s.isActive) for filtering active staff
- [x] Fix /slots endpoint: accept optional staffLocalId + locationLocalId query params
- [x] Fix booking page loadSlots: pass selectedStaff.localId + selectedLocation when fetching slots
- [x] Fix booking page checkDayAvailability: pass staff + location params
- [x] Fix booking page isWorkingDay: use selected location workingHours when location selected
- [x] Fix booking page: clear slotCache when staff or location changes
- [x] Fix locations API: include workingHours in response
- [x] Staff list screen: show location assignments and per-day workday summary

## Responsive Layout (Phone + Tablet + Web)
- [x] Create useResponsive hook with phone/tablet/web breakpoints
- [ ] Fix tab bar: wider tabs with labels on tablet/web, proper sizing
- [ ] Fix appointment-detail: add responsive padding and tabletMaxWidth centering
- [ ] Fix service-form: add responsive padding and tabletMaxWidth centering
- [ ] Fix new-booking: add responsive padding and tabletMaxWidth centering
- [ ] Fix business-hours-settings: add responsive padding and tabletMaxWidth centering
- [ ] Fix schedule-settings: add responsive padding and tabletMaxWidth centering
- [ ] Fix booking-policies: add responsive padding and tabletMaxWidth centering
- [ ] Fix data-export: add responsive padding and tabletMaxWidth centering
- [ ] Fix product-form: add responsive padding and tabletMaxWidth centering
- [ ] Fix home screen: 3-column KPI on large tablet, 2-column upcoming list on tablet
- [ ] Fix calendar screen: wider day/week view on tablet, better use of horizontal space
- [ ] Fix settings screen: 2-column layout for settings groups on tablet/web
- [ ] Ensure all screens with tabletMaxWidth=0 properly use full width with correct padding

## Global Location Context

- [ ] Add city, state, zipCode fields to Location type and DB schema
- [x] Add activeLocationId to global store with AsyncStorage persistence
- [x] Create useActiveLocation hook
- [x] Create LocationSwitcher component (header picker)
- [ ] Scope Staff list to active location
- [ ] Scope Staff form location assignment to active location
- [ ] Scope Staff calendar to active location
- [ ] Scope Calendar tab to active location (replace local filter with global)
- [ ] Scope Business Hours settings to active location
- [ ] Scope Schedule settings to active location
- [ ] Fix onboarding: split address into Address/City/State/ZIP, create first location
- [ ] Update Settings: location switcher at top, separate profile vs location data
- [ ] Auto-set active location on app load (default location or first location)

## Address Display & Business Profile Refactor

- [ ] Add formatFullAddress utility to types.ts
- [ ] Show formatted address in location cards (locations.tsx)
- [ ] Show formatted address in location-form header/preview
- [ ] Create business-profile.tsx screen (Name, Owner, Phone, Email, Website, Description — no address)
- [ ] Add Business Profile nav item to Settings locationNavItems
- [ ] Remove Business Profile inline card from settings.tsx
- [ ] Remove address field from BusinessProfile interface and settings profile form
- [ ] Add exclusive active-location toggle (Switch) at top of each location card
- [ ] Ensure toggling a location active deactivates all others
- [ ] Add required field validation (inline errors) to location-form
- [ ] Remove Business Hours section from location card in locations.tsx (it's now in Schedule & Hours)
- [x] Add Copy Booking Link button to each location card with toast feedback and cross-platform clipboard support
- [x] Add Share button to each location card that shares that specific location's unique booking URL via native Share sheet
- [x] Make Email and Owner Name optional in Business Profile (remove required validation)
- [ ] Remove Default Location toggle from location-form Settings section
- [ ] Remove Business Hours section from location-form (managed via Schedule & Hours)
- [ ] Staff-form: single-select location (not multi), pre-filled with active location, no "all locations" toggle
- [ ] Staff-calendar: disable past dates and days-off from being selectable (not just dimmed)
- [ ] Staff screen: replace location number badges with tappable location name that opens location switcher
- [ ] Staff screen: verify Remove/Delete staff button works correctly
- [x] Add location name/address to booking confirmation email
- [x] Add location name/address to web booking confirmation HTML
- [x] Add location name/address to in-app booking.tsx confirmation step
- [x] Add location name/address to appointment-detail.tsx
- [x] Surface per-location shareable booking links in Settings > Location screen
- [x] Update SMS acceptance message to use appointment's specific location name and address
- [x] Add location name and address to cancellation SMS message
- [x] Add location name and address to rejection SMS message
- [x] Add active location name and address to PDF export header
- [x] Fix booking link to use lime-of-time.com domain with correct business slug
- [x] Fix Share button to share correct per-location URL
- [x] New locations default to inactive (toggle off) with no placeholder name
- [x] Split address into Address, City, State, Zip fields in location form
- [x] Enforce single active location at a time (radio-style toggle)
- [x] Update public booking page to use correct domain in confirmation
- [x] Auto-activate first location added to prevent empty state
- [x] Fix web share link /book/slug to redirect to /api/book/slug
- [x] Fix address in SMS messages to show full address (street, city, state, zip)
- [x] Fix all SMS booking links to use https://lime-of-time.com domain
- [ ] Fix Business Hours/Calendar mismatch: calendar must use same per-location workingHours as Schedule & Hours
- [ ] Fix Clients tab: filter by active location using clientsForActiveLocation
- [ ] Add location switcher to Clients tab so clients can switch between locations
- [x] Location picker sheet on Home screen Share button — choose location without switching active
- [x] Reopen date on Temporarily Closed — optional YYYY-MM-DD date field with auto-reopen on app load
- [x] Fix web booking page address to show full address (Street, City, State ZIP)
- [x] Fix Business Hours/Calendar mismatch: calendar must use per-location workingHours
- [x] Fix Clients tab: filter by active location using clientsForActiveLocation
- [x] Remove "Today" button from Calendar header
- [x] New location should be disabled (active=false) by default until manually enabled
- [x] Locations: enforce single-active-location mutual exclusion (only one ON at a time)
- [x] Temporarily Closed: block Calendar and Staff Calendar from showing available slots
- [x] Add Location Switcher to Clients tab for filtering client list by location
- [x] Add location badges on client cards showing which locations they have visited
- [x] Remove Add Review and Delete Review buttons from client Reviews tab (read-only)
- [x] Remove Temporarily Closed toggle from Booking Policies screen
- [x] Replace YYYY-MM-DD text input with calendar date picker for Reopen Date in locations
- [x] Fix Temporarily Closed toggle wiping location address/data when toggled on
- [x] Fix Temporarily Closed toggle deleting/removing the location
- [x] Calendar: all future days red and unselectable when active location is temporarily closed
- [x] Staff Calendar: all future days red when location is temporarily closed
- [x] Home screen: red banner showing temporarily closed status with reopen date
- [x] Client booking page: professional "temporarily closed" message with reopen date

## Temporarily Closed UI Propagation
- [ ] Home page: show Temporarily Closed banner when location is closed
- [ ] Main calendar: show red days for the Temporarily Closed period (today through reopenOn date)
- [ ] Staff calendar: show red days for the Temporarily Closed period
- [ ] Client booking page: show Temporarily Closed message with reopen date
- [ ] All pages update in real-time when toggle changes (no reload required)
- [ ] Test full address display on client booking page
- [ ] Fix any address display bugs on client booking page

## UI/Design Overhaul
- [x] Update theme.config.js with deep sage green / dark navy brand palette
- [x] Add surfaceElevated and surfaceAlt tokens to theme.config.d.ts
- [x] Load Inter font weights (300–700) in app/_layout.tsx
- [x] Redesign onboarding screen: animated gradient background, floating particles, logo ring, progress dots, spring button
- [x] Redesign home screen header: gradient greeting banner with brand color
- [x] Upgrade KPI cards to full gradient cards (orange, blue, green, purple) with white text
- [x] Improve Today's Schedule section: count badge, time block pill, improved empty state
- [x] Upgrade FAB to gradient with scale press feedback and stronger shadow

## Data Persistence / DB Connectivity (TestFlight)
- [x] Fix API base URL: TestFlight builds must point to production server, not localhost
- [x] Fix auth login: phone lookup must query DB and return existing owner data
- [x] Fix data sync: all CRUD operations must write to DB on TestFlight (not just local AsyncStorage)
- [x] Fix logout: data must persist in DB so re-login restores all data
- [x] Fix new business registration: owner record must be created in DB on onboarding (no silent fallback)
- [x] Verify tRPC client URL is set correctly for production builds
- [x] Test phone 412-482-7733 can find existing owner in DB after fix
- [x] Fix phone normalization in DB lookup (server/db.ts + server/routers.ts)
- [x] Fix logout to clear ALL 14 AsyncStorage keys (not just 6)
- [x] Fix handleDeleteBusiness to clear ALL AsyncStorage keys
- [x] Improve DB failure logging in store bootstrap and syncToDb

## Home Page UI & Build Fixes
- [x] Fix @expo-google-fonts/inter build error - remove package, use system fonts
- [x] Fix KPI card grid alignment (equal height, proper 2-col grid on all screen sizes)
- [x] Add modern weekly revenue/appointments bar chart to home page
- [x] Add upcoming appointments section at bottom of home page (max 10, sorted by date/time)
- [x] Responsive layout audit: tablets and phones across all tab screens

## KPI Card Redesign & Detail Sheets
- [x] Redesign KPI cards: embedded sparkline charts, decorative circles, scale press animation, premium typography
- [x] Revenue KPI detail sheet: monthly bar chart + daily line chart + service breakdown
- [x] Appointments KPI detail sheet: daily bar chart + status breakdown + by-service breakdown
- [x] Clients KPI detail sheet: top clients ranked by visits + total spent
- [x] Top Service KPI detail sheet: all services ranked with horizontal progress bars
- [x] Wire detail sheets to KPI card onPress (open bottom sheet instead of navigating away)

## KPI Card & Home Page Polish
- [x] Remove "Details ›" text from KPI card bottom-right corner
- [x] Add count-up animation on KPI values when home screen mounts
- [x] Add Download Report button to each KPI detail sheet (PDF export)
- [x] Fix phone number formatting in appointment detail: (123) 456-7890 or +1 (123) 456-7890
- [x] Fix location in appointment detail: show full address (street, city, state, zip)
- [x] Redesign upcoming appointments section to match screenshot (colored left border, time block, service/client/staff, status badge, price)

## Upcoming Appointments Card Redesign (v2)
- [x] Redesign upcoming cards: colored left border, date·time range top line, service+duration, client·phone, staff dot, status badge, price

## Phone Number Formatting Fix
- [ ] Add formatPhone utility to lib/utils.ts
- [ ] Apply formatPhone in home page upcoming cards
- [ ] Apply formatPhone in calendar appointment list (all tabs)
- [ ] Apply formatPhone in appointment detail screen

## Push Notifications & Email Deep-Link Routing (Apr 13, 2026)
- [x] Add expoPushToken column to businessOwners DB schema + migration
- [x] Add expoPushToken to business.update tRPC router
- [x] Create server/push.ts with Expo Push API integration (notifyNewBooking, notifyCancellation, notifyReschedule, notifyWaitlist)
- [x] Update publicRoutes.ts: use Expo push for all 4 notification events (new booking, cancel, reschedule, waitlist) with Manus notifyOwner fallback
- [x] Update use-notifications.ts: register Expo push token on device, save to server via tRPC
- [x] Add expo-device package for physical device detection
- [x] Add expo-notifications plugin to app.config.ts with Android channel config
- [x] Create notification-icon.png for Android notification tray
- [x] Deep-link routing: appointment_request/rescheduled → Calendar Requests tab; appointment_cancelled → Calendar Cancelled tab; appointment_reminder → appointment detail; waitlist → Calendar Requests tab
- [x] Set RESEND_API_KEY environment variable for email sending from noreply@lime-of-time.com

## New Features & Fixes (Apr 13, 2026 - Session 2)
- [x] Fix expo-linear-gradient missing dependency (install package + add to app.config.ts plugins)
- [x] Add client confirmation email when business owner accepts appointment
- [x] Build notification preferences screen in Settings (toggle push/email per event type)

## iOS Crash Fix (Apr 13, 2026 - Session 3)
- [x] Fix iOS crash: Object.fromEntries(response.headers.entries()) crashes on iOS 26 / iPhone 16 Pro Max (Hermes SIGSEGV in objectFromEntries)

## Production Quality & Crash Reporting (Apr 13, 2026 - Session 4)
- [x] Create dev-only logger utility (lib/logger.ts) — replaces console.log with no-ops in production
- [x] Clean up all debug console.log calls in lib/_core/api.ts
- [x] Clean up debug console.log calls in other core lib files (auth.ts, store.tsx, trpc.ts)
- [x] Install and configure @sentry/react-native for automatic crash reporting
- [x] Wire Sentry into app _layout.tsx as error boundary
- [x] Add SENTRY_DSN environment variable (EXPO_PUBLIC_SENTRY_DSN — user must set from Sentry dashboard)

## EAS Build Fix (Apr 13, 2026 - Session 5)
- [x] Fix EAS iOS build failure: sentry-cli requires auth token for source map upload — add SENTRY_ALLOW_FAILURE=true to eas.json so build succeeds without a Sentry account configured

## Settings Tab Crash Fix (Apr 13, 2026 - Session 6)
- [x] Fix crash: settings.notificationPreferences undefined for existing users — add safe fallback merge with DEFAULT_NOTIFICATION_PREFERENCES in store and settings screen

## Multi-Bug Fix (Apr 13, 2026 - Session 7)
- [x] Investigate and fix APK build failure (removed Sentry Expo plugin that blocked Android Gradle build)
- [x] Fix SMS phone number format (showing raw digits instead of formatted e.g. (412) 555-0001)
- [x] Restore SMS pre-fill with appointment details after clicking Confirm Booking (was already present and working)
- [x] Fix Business Profile text inputs losing focus/keyboard dismissing after first character typed (moved Field component outside screen function)

## Session 8 (Apr 13, 2026)
- [x] Fix share link on Home page broken on TestFlight (Share API correct; issue is lime-of-time.com domain not deployed yet)
- [x] Fix client phone number display format in Clients list (raw digits → formatted)
- [x] Replace static splash screen with creative animated splash (AnimatedSplash with Reanimated)
- [x] Add country code picker (+1 US, +44 UK, all countries) to login phone input
- [x] Add static OTP verification screen (code: 123456) for all users after phone entry
- [x] Fix Rate Exceeded errors across the app (throttledNotifyOwner with 60s cooldown)

## Session 9 (Apr 13, 2026)
- [ ] Fix login page: show dial code number (+1) next to flag in country code picker
- [ ] Fix calendar timeline: appointments overlapping when multiple locations exist
- [ ] Add location filter to calendar timeline view

## Phase: Current Sprint

- [ ] OTP screen: show inline error message when incorrect code entered
- [ ] OTP screen: ensure Resend Code link is always visible after countdown
- [ ] Calendar: remove "All" from location filter chips; default to first location
- [ ] Settings → Schedule Hours: add per-location selector so each location has individual business hours
- [ ] Social login: add Google / Apple / Microsoft sign-in buttons on login page
- [ ] Social login: collect phone number from new social-login users on first sign-in

## Bug Fixes & Feature Requests (Apr 13 2026)

- [ ] Fix calendar tab showing wrong day of week (Apr 13 2026 shows Wednesday instead of Monday)
- [ ] Add custom buffer time option (free-text minutes input alongside preset chips)
- [ ] Set cancellation fee disabled by default, add helper text explaining it
- [ ] Fix Active Until toggle — cannot switch it back off after turning on
- [ ] Change workday minute picker steps from 0/15/30/45 to 0/5/10/15/20/25/30/35/40/45/50/55
- [ ] Build Notifications management page under Settings (manage message content, toggle per notification type)
- [ ] Fix OTP input showing raw digits instead of styled OTP boxes
- [ ] Fix Apple sign-in button showing wrong/missing icon
- [ ] Fix phone number input placeholder showing (000) 000-0000 style
- [ ] Fix Get Started button appearing greyed out on Business Information screen
- [ ] Fix splash screen not showing on TestFlight builds (app.config.ts)

## Phase: Location/Address Bug Fixes

- [x] Fix onboarding: await syncToDb for first location so it saves to DB before navigating away
- [x] Fix onboarding: save city/state/zip to BusinessProfile for SMS fallback
- [x] Fix share link: handle case where location not yet in DB (use slug-only fallback)
- [x] Fix SMS messages: use full address (city, state, zip) from location, not just street
- [x] Fix clients page: ensure location address displays correctly

## Phase: Location Edit & Public Booking Page Improvements

- [x] Verify location edit flow updates store correctly (address, city, state, zip reflected in share links)
- [x] Fix location edit: ensure UPDATE_LOCATION action syncs city/state/zip to DB
- [x] Public booking page: pre-select location from ?location= URL param
- [x] Public booking page: show full address (street + city + state + zip) prominently when location is pre-selected
## Phase: Calendar & SMS Manager (Apr 13 2026)
- [x] Fix public booking page calendar: apiWeeklyDays not stored from loadWorkingDays response — calendar shows all days greyed out
- [x] Add SMS Message Manager screen under Settings (editable templates per event type, locked Lime Of Time footer)
- [x] Wire custom SMS templates into appointment-detail.tsx and client-detail.tsx message generators
- [x] Add followUp template type to SmsTemplates interface and DEFAULT_SMS_TEMPLATES
- [x] Fix client booking page calendar sync with business calendar (slots not reflecting actual availability)
- [x] Add onboarding intro/welcome screen before Business Information tab
- [x] Pre-fill location phone from business phone when creating first location
- [x] Prompt address fields when creating first location (address no longer collected in onboarding)
- [x] Add validation error messages to staff creation form for required fields
- [x] Add error message popups throughout the client detail page
- [x] Fix email sender to no-reply@lime-of-time.com
- [x] Add location-specific business hours section inside Location edit page
- [x] Update booking confirmation SMS template to include full address
- [x] Add QR code generation per location in Location edit page

## Phase: Booking Link Fix & UI Modernization (Apr 14 2026)
- [ ] Fix shared booking link URL format - single location and multi-location
- [x] Redesign splash screen - modern, works on all iOS/Android sizes
- [x] Redesign login page - modern UI with animations
- [x] Redesign OTP page - 6 individual input boxes with forward/backward fill animation
- [x] Redesign onboarding Business Information page - modern UI
- [x] Add connected animations between login → OTP → onboarding screens
- [ ] Add phone widgets - calendar widget and upcoming/requested/cancelled appointments
- [x] Add Save QR to Photos button in QR code modal
- [x] Add Business Hours section when creating a new location (Add Location page)

## Phase: UI Modernization & Widgets (Apr 14 2026)
- [x] Redesign splash screen - modern, works on all iOS/Android sizes
- [x] Redesign login page - modern UI with smooth animations
- [x] Redesign OTP page - 6 individual input boxes, fills L→R, deletes R→L, connected animations
- [x] Modernize onboarding Business Information page with connected animations
- [x] Add Save QR to Photos button in QR code modal
- [x] Add Business Hours section when creating a new location (Add Location page)
- [ ] Add phone widgets - calendar widget and upcoming/requested/cancelled appointments widget

## Phase: Onboarding Slide Transitions (Apr 14 2026)
- [x] Add slide-left/slide-right animated transitions between onboarding steps (Step 1 → 2 → 3)

## Phase: Splash/Tour/OTP Improvements (Apr 14 2026)
- [ ] Make Business Phone a required field on onboarding Business Information step
- [ ] Add haptic feedback on each OTP box fill and delete
- [ ] Improve splash screen layout, vertical centering, and animated transition into login page
- [ ] Build modern guided first-launch tour with rich step-by-step Settings walkthrough popups
- [x] App icon badge count — set iOS/Android home screen badge to number of upcoming appointments today
- [x] Settings tab badge — show red dot badge on Settings tab when push notification permission is denied
- [x] Fix: cannot delete client — investigate and fix deletion bug
- [x] Fix: reviews from deleted clients must be preserved (not cascade-deleted)
- [x] Fix: Schedule & Hours screen in Settings throws error — investigate and fix crash
- [x] Fix: Delete Client button taps do nothing — deep debug required
- [x] Fix: email sender shows 'Manus Team' — change to 'Lime Of Time' with no-reply@lime-of-time.com
- [ ] Fix: Splash screen is static (no animation) and cuts abruptly to dashboard — add logo pulse/scale animation and fade transition
- [ ] Audit: Workday logic across the app and client page — verify correct behavior everywhere
- [ ] All Locations calendar: show union of all location slots (not just first/active location)
- [ ] All Locations calendar: show per-slot location count badge (e.g. "3 locations available")
- [ ] Booking flow: auto-assign correct location when slot selected in All Locations mode
- [ ] Multi-location availability: consistent across calendar, new-booking, staff-calendar screens
- [x] Configurable slot step interval in Settings (5/10/15/30 min picker)
- [x] Refresh availability button on booking time slot grid (new-booking + booking screens)
- [x] Workday "Repeat next week" quick-copy button in calendar Workday panel
- [ ] Fix clients page scroll (list not scrollable)
- [ ] Remove center number from "By Service" donut chart on home page
- [ ] Seed DB: ~6000 past appointments (last 6 months) + 200 upcoming appointments
- [ ] Seed DB: 200 more clients
- [ ] Seed DB: 50 more services with different categories
- [ ] Seed DB: 100 products with different brand names
- [ ] Seed DB: add discounts and gift cards so Quick Actions shows non-zero counts
- [x] Before/After Photo Gallery per client: ClientPhoto type, clientPhotos state, Photos tab in client detail
- [x] Birthday Campaigns screen: filter today/upcoming/all, send SMS with discount code
- [x] Birthday cake button in Clients tab header → Birthday Campaigns screen
- [x] Online Booking: staff picker step added (service → staff → datetime)
- [x] Staff selection saved to appointment.staffId, shown in booking summary confirm step
- [x] Calendar Sync (.ics export): confirmed present in Staff Calendar screen
- [x] GitHub dev branch pushed with all new features
- [x] Birthday auto-reminders — daily 8 AM push notification listing today's birthdays
- [x] Photo lightbox — full-screen swipe gallery with pinch-to-zoom for before/after photos
- [x] Staff availability indicator — green/grey dot on booking staff picker
- [ ] Birthday notification toggle in Notification Settings
- [ ] Location Active Until date field in location add/edit
- [ ] Phone number format fix in Locations list
- [ ] Service/product category grouping + optional photos on booking page
- [ ] Workday close guard — popup + no-new-bookings mode
- [x] Birthday notification toggle in Notification Settings
- [x] Location Active Until date field in location add/edit form
- [x] Phone number formatting fix in Locations list
- [x] Service category grouping on public booking page
- [x] Service optional photos on public booking page
- [x] Product optional photos in product form
- [x] Workday close guard - popup when appointments exist on that day
- [x] Birthday reminder time picker in Notification Settings
- [x] Category Management screen (service categories, product categories, product brands)
- [x] Services/Products layout gap fix when switching categories
- [x] Booking page service step: two-level drill-down (category tiles → service list → detail bottom sheet with select button)
- [x] Service form: optional description field added (shown in booking page detail sheet)
- [x] Services/Products tab: layout gap fixed (flex:1 propagation corrected)
- [x] Birthday reminder time picker in Notification Settings (6 AM–10 AM)
- [x] Category Management screen in Settings (service categories + product categories/brands)
- [x] Booking page products step: brand tiles → product list → detail bottom sheet with Add to Cart / quantity controls
- [x] Booking page confirm step: shows selected products with subtotal and remove buttons
- [x] Appointment saved with extraItems (product line items) and updated totalPrice including products
- [x] Confirm step back button navigates to products step when products exist
- [x] Datetime step continue button navigates to products step when products exist, otherwise directly to confirm
- [x] Extras step: Services tab — show category tiles first, tap category → service list, tap service → detail sheet with photo
- [x] Extras step: Products tab — show brand tiles first, tap brand → product list, tap product → detail sheet with photo
- [x] Remove flat list view from both Services and Products tabs in Extras step
- [x] Extras step: "All" tile at top of category/brand grids to browse all items
- [x] Extras step: real-time search bar filtering services/products by name
- [x] Service form: photo upload field so photoUri is set and shows in booking detail sheet (already existed)
- [x] Test full booking flow on live site and fix any issues found
- [x] Fix Auto-Complete Appointments not marking past confirmed appointments as completed
- [x] Step 2 primary service selection: category tile drill-down (category tiles → service list → detail sheet with Select button)
- [ ] Step 2 search: match category names in addition to service names
- [ ] Step 2: "Most Popular" horizontal scroll row above category tiles (top 3-5 most-booked services)
- [ ] Step 2 detail sheet: improve photo placeholder when no photoUri set
- [ ] Fix Staff Performance screen: "6 Mo" tab clipped off-screen, stat boxes overlapping

## Batch 10 Features (Apr 15 2026)
- [x] Remove hardcoded phone number 4124827733 from all non-seed files
- [ ] Staff commission tracking (commission % field + Commission Due on Staff Performance)
- [x] Cancellation reason tracking (prompt on cancel + breakdown chart in Analytics)
- [x] Revenue forecast widget on home dashboard
- [x] Appointment note templates (reusable notes per client profile)
- [ ] Client birthday field and birthday discount auto-apply logic
- [x] Before/after photo gallery per service (service-gallery.tsx with before/after tagging)
- [ ] Waitlist feature for fully-booked slots (booking page)
- [x] Service bundle/package deals (packages.tsx with purchase + redemption tracking)
- [x] Twilio SMS: booking reminders, rebooking nudge, birthday SMS (twilio-setup.tsx + sms-automation.tsx)

## SaaS Platform — Phase 1: DB + Server Foundation
- [x] Add subscription columns to business_owners table (subscriptionPlan, subscriptionStatus, subscriptionPeriod, trialEndsAt, adminOverride, adminOverrideNote, stripeCustomerId, stripeSubscriptionId)
- [x] Create subscription_plans table with all 4 tiers (Solo/Growth/Studio/Enterprise)
- [x] Seed subscription_plans with pricing and limits
- [x] Add server-side plan limit middleware (enforce client/staff/location/service/product limits)

## SaaS Platform — Phase 2: Admin Panel Expansion
- [x] Add Subscriptions tab to admin panel (list all businesses with plan/status/trial)
- [x] Add Plan Pricing tab to admin panel (edit plan names, prices, limits, isPublic toggle)
- [x] Add Twilio Configuration section in admin Settings (Account SID, Auth Token, From Number, Test Mode toggle with 123456 bypass)
- [x] Add Stripe Configuration section in admin Settings (Publishable Key, Secret Key, Webhook Secret)
- [x] Add Admin Override toggle on each Business Detail page (grant Unlimited for free)
- [x] Update admin URL references to lime-of-time.com/admin

## SaaS Platform — Phase 3: OTP Login
- [x] Add phone number entry screen (replaces current onboarding first screen)
- [x] Add OTP entry screen (6-digit code)
- [x] Add Face ID enable prompt after first successful OTP
- [x] Server: /api/auth/send-otp endpoint (Twilio SMS, respects test mode)
- [x] Server: /api/auth/verify-otp endpoint

## SaaS Platform — Phase 4: Subscription UI in App
- [x] Add Subscription screen in Settings (current plan, usage meters, trial countdown)
- [x] Add Choose a Plan screen (shows only isPublic plans)
- [x] Add feature gates (upgrade prompts when limits hit)
- [x] Admin Override businesses show Complimentary badge

## SaaS Platform — Phase 6: Client Booking Page Payments
- [x] Add Payment Tab in business Settings (Zelle/CashApp/Venmo handles)
- [x] Show payment options on booking confirmation page

## SaaS Platform — Phase 7: SMS Gating + Production Hardening
- [x] Gate SMS automation by subscription plan
- [x] Remove Twilio credentials from mobile app (server-only)
- [ ] Rate limiting on SMS and OTP endpoints

## Booking Page QR Codes + Admin Redesign
- [x] Add QR code generation for Zelle/CashApp/Venmo on client booking confirmation page (server-rendered)
- [x] Redesign admin panel: cleaner layout, sidebar nav, better visual hierarchy
- [x] Admin: add search bar to Businesses tab
- [x] Admin: add sort/filter controls per tab (by plan, status, date, name)
- [x] Admin: add quick-action buttons per business row (view, edit plan, toggle override)
- [x] Admin: improve Subscriptions tab with plan distribution chart and summary cards
- [x] Admin: improve Plan Pricing tab with inline editing
- [x] Admin: improve Settings tab layout with clear sections

## Admin Filtering + Analytics Dashboard
- [x] Add search/filter to Discounts page (by business, name, type)
- [x] Add search/filter to Gift Cards page (by business, status, code)
- [x] Add search/filter to Reviews page (by business, rating)
- [x] Add search/filter to Products page (by business, name)
- [x] Build Admin Analytics Dashboard (total revenue, MRR, churn, signups/week)
- [x] Per-business revenue breakdown table with sort/filter
- [x] Weekly signups chart (last 12 weeks)
- [x] MRR trend chart (last 12 months)
- [x] Wire analytics to sidebar nav

## Admin Panel Crash Fixes
- [ ] Test all admin pages in headless mode and fix all crashes

## Post-Payment Subscription Sync & Email Confirmation
- [x] Add post-payment subscription sync: invalidate getMyPlan and getFullData queries after Stripe browser closes in onboarding
- [x] Add useFocusEffect to Subscription screen to auto-refetch plan data when screen gains focus
- [x] Add sendSubscriptionConfirmationEmail function to email.ts with branded template
- [x] Send subscription confirmation email in webhook handler (checkout.session.completed)
- [x] Send subscription confirmation email in success route (fallback when webhook hasn't fired yet, deduplication check)
- [x] Fix free plan response: server returns activated:true + free:true, client handles both flags

## Subscription UX Enhancements
- [ ] Enrich Subscription screen with full plan benefits comparison table (all 4 plans)
- [ ] Add plan upgrade prompt sheet when limits are hit (clients, services, staff, products, locations)
- [ ] Add Stripe Customer Portal endpoint and Manage Billing button in Subscription screen
- [ ] Add 3-day renewal push notification (server-side cron job)

## Subscription Enhancements (Apr 16, 2026)
- [x] Enrich Subscription screen with full plan benefits comparison table
- [x] Add Manage Billing button (Stripe Customer Portal deep link)
- [x] Add plan upgrade prompt sheet when limits are hit (clients, services, staff, products, locations)
- [x] Add 3-day renewal push notification cron (hourly check, fires once per renewal)
- [x] Add stripeCurrentPeriodEnd column to businessOwners schema
- [x] Save stripeCurrentPeriodEnd from Stripe webhook
- [x] Redesign choose-plan screen as horizontal swipeable carousel with all 4 plans, animated transitions, pagination dots, and full feature details per slide

## Bug Fixes (Apr 16 batch)
- [x] Fix Share Booking Link on home screen (not opening share sheet on TestFlight)
- [x] Fix QR code — show all locations or per-location unique QR, not just first location
- [x] Multi-location booking link: shared QR/link should open location selector first
- [x] Fix monthly goal tap — navigating to incorrect page
- [x] Fix Today's Schedule on home screen
- [x] Fix Analytics Generate Report not working for Analytics Overview
- [x] Fix SMS Automation — remove Twilio dependency, route through app backend subscription
- [x] Fix plan carousel snap — only snaps once, should snap to center on each swipe
- [x] Fix KPI cards on home (This Week Revenue Trend etc.) — tap should navigate to detail page

## UX Improvements (Apr 16 batch 2)
- [x] Per-location QR picker modal on home screen — location picker before QR when multiple locations exist
- [x] Today's Schedule empty state — show "No appointments today" with quick-book CTA
- [x] Plan carousel arrow buttons — left/right arrow buttons for iPad/web navigation

## Bug Fixes & UX (Apr 16 batch 3)
- [x] Fix header overlap on iPhone push screens (Add Staff, Add Location, New Booking) — status bar overlaps title
- [x] Timeline: merge 12 AM and 12 PM labels, make timeline scrollable on all screens that use it
- [x] Services list layout — service card looks sparse/empty, improve visual density
- [x] Products list layout — product card looks sparse/empty, improve visual density
- [x] In-app booking service selection — add category filter chips (like client booking flow)
- [x] Add-optional products step in booking — add category/brand filter
- [x] Birthday date picker — center the picker columns (currently left-aligned)
- [x] Plan comparison table — full-screen modal with side-by-side feature matrix for all plans

## Features (Apr 16 batch 4)
- [x] Staff member profile photo — image picker in staff-form, avatar displayed in staff list and detail
- [x] Timeline auto-scroll to current hour on open (calendar and staff-calendar)

## Features (Apr 16 batch 5)
- [ ] Payment step on client web booking — Zelle/Venmo/CashApp/Cash options before confirmation
- [ ] Payment step in in-app new-booking flow — same payment methods
- [ ] Payment data model — method, status (paid/unpaid/pending), confirmation number on Appointment
- [ ] Business owner marks payment received with confirmation number (digital) or confirms cash
- [ ] Payment status shown on appointment detail, calendar cards, and SMS messages
- [ ] Staff photo shown in appointment detail and SMS confirmation
- [ ] Timeline jump-to-now floating "Now" pill button on calendar and staff-calendar
- [ ] Staff availability dot — green (working today) / grey (off) on staff list

## Features (Apr 16 batch 6)
- [x] Unpaid filter on Appointments (Calendar) screen — Unpaid/Paid chips added to filter row
- [x] Deep-link from Payment Summary card on home screen to Unpaid filter (Outstanding tap → Unpaid list, Paid tap → Paid list)
- [x] Payment amount badge shown on each card when viewing Unpaid or Paid filter

## Features (Apr 16 batch 7)
- [x] Mark as Paid button on each card in the Unpaid filter — single tap records payment
- [x] Unpaid filter summary header — show total outstanding amount and count above the list
- [x] Filter chip persistence — remember last-used filter across navigation

## Features (Apr 16 batch 8)
- [x] Payment method picker in Mark as Paid flow (Cash, Zelle, Venmo, Card)
- [x] Bulk Mark All Paid button on the Unpaid summary banner
- [x] Payment badge and Mark as Paid button on Appointment Detail screen

## Features (Apr 16 batch 9)
- [x] Payment method breakdown on home dashboard — fix Zelle/Venmo/Cash/Card totals to use stored paymentMethod values

## Bugs (Apr 16 batch 10)
- [x] Subscription plan carousel cards cut off / overflowing on left and right sides
- [x] Skip for now button on subscription step not working

## Bugs (Apr 16 batch 11)
- [x] Save button not tappable on first open for New Service screen — fixed: added pointerEvents="none" to AnimatedSplash Animated.View
- [x] Save button not tappable on first open for Add Staff Member screen — fixed: same AnimatedSplash fix
- [x] Save button not tappable on first open for Add Location screen — fixed: same AnimatedSplash fix + usePlanLimitCheck now allows action when businessOwnerId/planInfo not yet loaded (prevents false upgrade-sheet block)

## Bugs (Apr 16 batch 12)
- [x] Android: header hidden/cut off at top on all inner form/push screens (service-form, staff-form, location-form, schedule-settings, booking-policies, notification-settings, etc.) — fixed: replaced SafeAreaView in ScreenContainer with useSafeAreaInsets() directly, applying paddingTop/bottom/left/right as explicit style props; this ensures correct status-bar inset on Android regardless of presentation mode (fullScreenModal or card)

## Features (Apr 16 batch 13)
- [x] Payment method step in in-app new-booking flow — Zelle/Venmo/CashApp/Cash selection before confirmation
- [x] Payment method step on client web booking page — same payment options before confirmation
- [x] Reduce splash screen duration from ~2.6s to ~1.5s

## Bugs/Features (Apr 16 batch 14) [duplicate removed]

## Bugs/Features (Apr 16 batch 14)
- [x] Fix content flush against screen edges on inner screens — ScreenContainer now uses StyleSheet.flatten to detect caller padding and avoids overriding it with inset-based paddingLeft/Right:0
- [x] Add "Pay Later / Skip" option to client web booking payment step — new "Skip for now" tile + goToPaymentConfirm allows proceeding without selection
- [x] Floating "Jump to Now" pill button on calendar day/week timeline views — overlays bottom-center of timeline ScrollView with drop shadow
- [x] Floating "Jump to Now" pill button on staff-calendar timeline view — same pattern

## Features (Apr 16 batch 15)
- [x] Replace "Top Services" KPI on home screen with "Upcoming This Week" appointments KPI (confirmed + pending counts, daily spark, pending badge)
- [x] Admin panel: Twilio config already stored/loaded from DB — added dirty-state Save button (disabled until change)
- [x] Admin panel: Stripe config already stored/loaded from DB — same dirty-state Save button
- [x] Admin panel: Subscription plan pricing/limits already stored/loaded from DB — added dirty-state Save button per plan card
- [x] Admin panel: Business subscription override Save button also made dirty-state

## Features (Apr 16 batch 16)
- [x] Admin platform config: inline validation for Twilio (SID starts with AC, Auth Token 32 chars, phone E.164) and Stripe (live/test key prefix, webhook secret starts with whsec_) — red border + hint text on invalid, Save blocked until valid + dirty

## Features (Apr 16 batch 17)
- [x] Admin platform config: "Test Connection" button for Twilio — POST /api/admin/test-twilio, fetches account info via Twilio REST API, shows ✅ account name or ❌ error inline
- [x] Admin platform config: "Test Connection" button for Stripe — POST /api/admin/test-stripe, fetches balance via Stripe SDK, shows ✅ live/test mode + currency or ❌ error inline

## Features (Apr 16 batch 18)
- [x] Admin audit log: DB table + server-side logging on all config saves (platform config, plan pricing, subscription overrides)
- [x] Admin audit log: GET endpoint returning last 20 log entries
- [x] Admin audit log: panel on admin dashboard showing last 20 changes (who, what, when)
- [x] Admin businesses list: richer cards with better visual separation (plan badge, appointment count, client count, join date, status indicator)

## Features (Apr 16 batch 19)
- [x] Admin dashboard: quick-search input on recent businesses table (filter by name/phone inline)

## Features (Apr 16 batch 20)
- [x] Admin dashboard: plan-breakdown bar (Solo/Growth/Studio/Enterprise counts + proportional bar) in the stats row

## Features (Apr 16 batch 21)
- [x] Fix share button on homepage: web fallback uses navigator.share() or clipboard copy
- [x] Fix public booking page JS syntax error (broken single-quote in selectPaymentMethod onclick) that blocked the entire booking script from executing
- [x] Fix booking page step-0 visibility bug (owner.temporaryClosed flag incorrectly hiding the form even when location is open)

## Features (Apr 16 batch 22)
- [x] Booking confirmation page: "Add to Calendar" button that generates an .ics file (Apple Calendar + Google Calendar compatible) with all appointment details pre-filled

## Fixes (Apr 16 batch 23)
- [x] Fix payment badge on Confirm Booking step invisible in dark mode (light green bg + light text hardcoded)

## Features (Apr 17 batch 24)
- [x] Fix all hardcoded light green colors (#f0fdf4, #166534, #bbf7d0, #dcfce7) in booking page for dark mode
- [x] Add "Add to Calendar" Google Calendar link in booking confirmation email
- [x] 24-hour appointment reminder: cron job sends push notification to owner + email to client 24h before appointment

## Features (Apr 17 batch 25)
- [x] Settings → Notifications: add toggle to enable/disable 24h client reminder email (emailOnReminder)
- [x] 24h reminder email: include cancellation deadline (e.g. "Free cancellation until April 16 at 9:00 AM") and fee percentage
- [x] Fix hardcoded light green colors on manage appointment page and review page for dark mode (Add to Calendar btn, .status-confirmed, .msg-success)

## Features (Apr 17 batch 26)
- [x] Settings → Notifications: "Remind clients X hours before" selector (12h, 24h, 48h, 72h, 1 week) replacing hardcoded 24h window
- [x] Appointment reminder cron: use business's reminderHoursBefore setting instead of hardcoded 24h

## Features (Apr 17 batch 27)
- [x] Settings page: reorganize into tabs (Business, Notifications, Billing, Account)
- [x] Home pending banner: replace ? icon with a cleaner bell/clock icon
- [x] Home KPIs: replace "Upcoming This Week" with "Total Yearly Earnings", swap position with "Total Appointments"

## Features (Apr 17 batch 28)
- [x] Home screen: monthly goal progress bar below KPI grid
- [x] Referral/promo code system: DB schema, tRPC routes, store, UI in Settings → Tools tab
- [x] Referral/promo code: redemption on public booking page (client enters code at checkout)
- [x] Referral/promo code: usage tracking in analytics screen
- [x] Public booking page: staff selection step (skip if only 1 staff or no staff)
- [x] Public booking page: filter available time slots by selected staff member's schedule

## Features (Apr 17 batch 29)
- [x] Fix admin Platform Configuration (broken/not working)
- [x] Home screen: lime logo background watermark (dark mode: dark overlay, light mode: light overlay)
- [x] Analytics: Promo Code report breakdown (most used codes, total discount given, revenue via referrals)
- [x] Booking page: "No available times" friendly message with next available day suggestion
- [x] Settings → Business: social links (Instagram, Facebook, TikTok handle fields)
- [x] Public booking page footer: social link icons (tap-to-open)

## Features (Apr 17 batch 30)
- [x] Apply futuristic animated background to Calendar, Clients, Settings screens
- [x] Home screen: Today's Revenue chip in header (shows completed revenue for today)
- [x] Settings: move Theme Mode from Alerts tab to Account tab
- [x] Settings: add icon to Tools tab (wrench.fill → build)

## Features (Apr 17 batch 31)
- [x] Apply FuturisticBackground to analytics-detail.tsx screen
- [x] Today's Revenue chip: show appointment count alongside revenue (e.g., "3 appts · $240 today")

## Features (Apr 17 batch 32)
- [x] Fix large empty gap on Services page (Services and Products tabs) — added flexGrow:1 to FlatList contentContainerStyle
- [x] Push notification for new pending bookings — already fully implemented (notifyNewBooking in server/push.ts, token registered in use-notifications.ts)

## Features (Apr 17 batch 33)
- [x] Today's Revenue chip: tappable → navigates to Analytics Overview tab
- [x] Calendar tab icon: red badge count for pending appointment requests
- [x] Services tab: search bar above category chips to filter by service name

## Features (Apr 17 batch 34)
- [x] Fix iOS FlatList gap in Services and Products tabs (removed style={{flex:1}} from both FlatLists)
- [x] Add FuturisticBackground to Services tab screen
- [x] Products tab: add search bar above brand chips
- [x] Calendar Requests: swipe-to-approve/decline gestures on pending cards (SwipeableRequestCard component)
- [x] Analytics Overview: date range picker expanded with Today, This Week, Custom (modal with YYYY-MM-DD input)

## Features (Apr 17 batch 35)
- [x] Fix Share Link / QR not working for single-location businesses (fixed nested Pressable in QR modal blocking touch events on iOS)
- [x] Apply FuturisticBackground to all remaining screens and tabs (33 screens updated via Python script)
- [x] Swipe hint animation on first visit to Requests tab (showHint prop on SwipeableRequestCard, AsyncStorage tracks first visit)
- [x] Home KPI: 7-bar revenue sparkline chip showing daily revenue for current week (MicroBarSpark using weeklyDailyData)
- [x] Analytics Custom date range: added Last 7 days, Last 30 days, Last 90 days quick-select presets in modal

## Features (Apr 17 batch 36)
- [x] Fix onboarding subscription plan cards too wide / overflowing on mobile devices (negative marginHorizontal: -hp to escape ScrollView padding, pass full screen width to PlanCarousel)

## Features (Apr 17 batch 37)
- [x] Remove URL appended after "Powered by Lime Of Time" in SMS messages (fixed in index.tsx, location-form.tsx, locations.tsx)
- [x] Fix Services/Products FlatList filter layout — items appearing at bottom when category selected (removed flexGrow:1 from contentContainerStyle)
- [x] Fix QR modal Share button not working on home screen (added touch stop-propagation on inner View to prevent outer backdrop Pressable from consuming button taps)
- [x] Fix public booking page completely broken — JavaScript syntax errors in publicRoutes.ts prevented entire script from executing (fixed icsEsc regex escaping and \r\n literal in template literals)

## Features (Apr 17 batch 38)
- [x] Settings Account: replace version text with app logo image (already implemented - logo shown in Account tab)
- [x] Booking confirmation page: implement proper .ics file generation for Add to Calendar button (was already implemented, now works after JS syntax fix from batch 37)
- [x] Appointment management page: add Reschedule option (new time slot selection) — added Reschedule button + bottom sheet modal with calendar + time slots for pending/confirmed appointments
- [x] Fix onboarding subscription page freeze/crash — disabled outer ScrollView when on subscription step to prevent FlatList nesting freeze
- [x] Fix Pay Later Internal Server Error on public booking confirmation — mapped 'later' paymentMethod to null before DB insert to avoid ENUM constraint violation
- [x] Move Client Reviews from Settings Tools tab to Business tab
- [x] Fix Packages & Bundles back button — changed chevron.left.forwardslash.chevron.right to chevron.left
- [x] Move Packages & Bundles to Business tab
- [x] Promo Codes: replace Expires text input with scroll date picker (BirthdayPicker with YYYY-MM-DD ↔ MM/DD/YYYY conversion)

## Features (Apr 17 batch 39)
- [x] Redesign onboarding subscription step: vertical scroll, compact cards without white background, modern icons, fix header alignment — full PlanCarousel rewrite with accent strip, emoji icons, 4-col feature grid, transparent cards
- [x] Wire "Skip for now" button on onboarding subscription step (already existed, confirmed wired)
- [x] Add Reschedule request option on public booking confirmation page (client-side) — already fully implemented in publicRoutes.ts
- [x] Add promo code usage display on promo code cards — already implemented with usedCount/maxUses + progress bar

## Features (Apr 17 batch 40)
- [x] Highlight Growth plan in onboarding: "Most Popular" badge + elevated border + auto-highlight + auto-scroll when isOnboarding prop is passed
- [x] Reschedule confirmation SMS: when business owner confirms reschedule, send client SMS with new date/time + calendar/manage link
- [x] Promo code auto-deactivate: show "Limit Reached" badge + auto-set inactive when maxUses reached or expired
- [x] Interactive onboarding tour: TourOverlay component with spotlight cutout + arrow + message bubbles pointing to each tab (Home, Calendar, Clients, Services, Settings)
- [x] Onboarding tour: mandatory location setup step (last step points to Settings, CTA navigates to /location-form)
- [x] Application Usage Guide in Settings Tools tab (subscription-aware, covers all app actions)

## Features (Apr 17 batch 41)
- [x] Full account/business deletion: cascade delete all DB records (appointments, clients, services, products, staff, locations, settings, reviews, promo codes, etc.) when business owner deletes account — added promoCodes to server deleteBusinessOwner cascade
- [x] Full account/business deletion: wipe all local phone data (AsyncStorage all @bookease_* + @lime_* keys, SecureStore session token + user info) on both Delete Business and Log Out
- [x] Replay App Tour button in Settings Account tab (clears @lime_tutorial_seen, navigates to Home) and in Usage Guide screen with live analytics stats
- [x] Usage Guide deep-links: each of 13 sections has a "Go There" action button navigating directly to the relevant screen
- [x] Onboarding tour analytics: recordTourAnalytics() tracks completed/skipped + stepReached per session in @lime_tour_analytics; Usage Guide displays completion/skip counts and last step reached

## Features (Apr 17 batch 42)
- [x] Fix Replay App Tour not working: replaced one-time useEffect with useFocusEffect so tour re-checks on every Home tab focus; Settings button now uses router.push to guarantee focus event fires; tour state reset (step 0, fade 0) on replay
- [x] Guided first-action prompt: one-time modal after saving the very first location with Add a Service / Add a Client / Set Working Hours action buttons; @lime_first_action_shown key cleared on logout/delete
## Features (Batch 43)
- [x] Client/Service page dimensions match (card height, padding, avatar/icon size)
- [x] Sort order applies immediately on selection (no stale state) — sort chips A-Z/Recent/Most Appts
- [x] Settings Account tab: Version box moved to bottom (after Delete Business)
- [x] Plan carousel: remove auto-scroll/pre-selection of Growth plan
- [x] Plan carousel: add 14px spacing between cards
- [x] Plan carousel: each card has full colored border per plan accent color
- [x] First-action prompt: "Add a Service" opens /service-form directly (not just Services tab)
- [x] Tour: added "Add Services & Clients" step (tabIndex 3) pointing to Services/Clients + button
- [x] Onboarding confetti: react-native-confetti-cannon fires after first location saved

## Batch 45
- [x] Birthday field: removed cake emoji icon from picker row
- [x] Birthday renamed to Expire Date in picker header, all form placeholders, and client detail display label

## Batch 46
- [x] Client cards: Expired (red) / Expiring soon (amber) badge shown when expire date is past or within 7 days
- [x] Public booking page: Expire Date field removed (internal field only)

## Batch 47
- [x] Services/Products FlatList layout fix (cards render at top)
- [x] All notification defaults set to OFF
- [x] SMS Automation defaults set to OFF
- [x] Subscription gating for email notifications (Growth+ only)
- [x] Subscription gating for SMS automation (Growth+ confirmations, Studio+ full)
- [x] Admin override preserved (isAdminOverride grants full access)
- [x] Twilio OTP info panel added to Settings > Tools

## Batch 48
- [x] UpgradeSheet component with plan comparison table and CTA to Subscription screen
- [x] Wire UpgradeSheet into notification-settings.tsx locked email toggles (Pressable wrapper + lock icon)
- [x] Wire UpgradeSheet into sms-automation.tsx locked SMS master toggle and rule cards

## Batch 49
- [ ] Save Twilio credentials to platform config DB
- [ ] Fix Test Connection button for Twilio (real API call + success/error display)
- [ ] Fix Test Connection button for Stripe
- [ ] Verify OTP flow end-to-end with real Twilio number
- [x] Remove autoFocus from onboarding phone, OTP, and business-info screens so keyboard only opens on tap
- [x] Remove Done button from phone number entry screen (changed returnKeyType from "done" to "next")
- [x] Fix Choose Plan onboarding page to always start from top (Solo plan first, not scrolled to Most Popular)
- [ ] Investigate and fix discount not applying correctly when booking appointment from the app
- [x] Fix discount not applying correctly when booking appointment from the app (3 bugs fixed: maxUses persistence, maxUses enforcement at booking time, discount applied to full subtotal)
- [ ] Fix client portal: filter out past time slots for today's date (slot < current time must not show)
- [ ] Fix client portal: service images not appearing on booking portal
- [ ] Fix social media icons: improve visual design, fix TikTok logo visibility in dark mode
- [ ] Fix reschedule popup calendar: low contrast / poor visibility of dates
- [ ] Fix staff profile picture: not showing when selecting staff in app booking and client portal
- [ ] Fix Choose Plan popup: cards too close to edges, add padding and spacing between cards
- [ ] Fix Analytics tab: remove auto-scrolling slides carousel
- [ ] Fix New Service form: hide/disable SMS Reminder Timing if subscription doesn't include SMS
- [x] Fix Custom Date Range picker: replace text input with scroll-wheel date picker like birthday selector
- [ ] Fix Services/Products list layout: list appears too far below filter chips; add collapsible category/brand groups
- [x] Add live clock and date to home header with professional display
- [x] Add next appointment countdown widget in home header
- [x] Gate PDF downloads for free (solo) plan users with upgrade prompt
- [x] Fix promo code Apply button not working (applyPromoCode was nested inside applyGiftCode)
- [x] Fix product/service detail placeholder background color (changed from green to neutral grey)
- [x] Fix QR code Share button not working on iOS
- [x] Add quick action buttons (New Booking, View Today) to home header
- [x] Add promo code usage counter (X / Y uses) on Discounts screen
- [x] Auto-mark appointment as paid when total charge is $0
- [x] Fix Add to Calendar on booking confirmation page (full address, native iOS/Android calendar)
- [x] Add Complimentary badge on appointment detail for $0 appointments
- [x] Verify $0 appointments excluded from revenue totals
- [x] Fix promo code usedCount auto-increment when client uses code during booking
- [x] Add gap between analytics stat boxes (they are touching each other)
- [x] Add client email notification toggles to Notification Preferences screen
- [x] Gate client SMS sends by notification toggle (if SMS off, don't send to client)
- [x] Gate client email sends by notification toggle and subscription plan
- [x] Connect client notification toggles to subscription plan (paid plan only)
- [x] Add No-Show appointment status to types and store
- [x] Add No-Show action button on appointment detail screen
- [x] Add No-Show SMS template gated to Growth plan
- [x] Add No-Show notification toggle to Notification Preferences
- [x] Fix Mark as Paid not working correctly on appointment detail screen
- [x] Fix client booking portal step-1 Continue button not working
- [ ] Fix booking calendar not syncing with location-specific business hours
- [x] Fixed location business hours mismatch in new booking flow: normalize workingHours in ADD_LOCATION/UPDATE_LOCATION reducers, AsyncStorage cache load path, and use-active-location hook; treat empty {} same as null so global hours fallback works correctly
- [x] Fixed Mark Paid reverting to unpaid: dbAppointmentToLocal was not mapping paymentStatus, paymentMethod, paymentConfirmationNumber from DB columns back to local state — added all three fields to the return object
- [x] Gate document downloads behind subscription: free users see upgrade prompt instead of downloading
- [x] Fix KPI page to show fully including data and buttons
- [x] Add payment method label (Cash, Zelle, Venmo, etc.) alongside paid badge on appointment cards
- [x] Add outstanding revenue total in Unpaid list header (e.g., "3 appointments · $285 outstanding")
- [x] Add "Payment Confirmed" email toggle to notification settings (on/off like other email notifications)
- [x] Gate ALL email notifications behind paid subscription — free/Solo users cannot send any emails; show disabled state with upgrade prompt
- [x] Add "Compare all plans" full-screen modal in KPI sheet upgrade prompt with side-by-side feature matrix
- [x] Wire Top Service KPI card to open topservice tab directly
- [x] Add date range filter (This Week / This Month / All Time) to KPI detail sheet
- [x] Build Payment Summary page with date range filter, paid/unpaid breakdown, and subscription-gated PDF download
- [x] Redesign KPI Card 1 to swipeable Earnings slides (Today/Week/Month/Year/All Time)
- [x] Redesign KPI Card 2 to swipeable Clients slides (Total/Top Clients/Recently Added/Upcoming Birthdays)
- [x] Redesign KPI Card 3 to swipeable Appointments slides (Total/Today/Week/Month/Year)
- [x] Redesign KPI Card 4 to swipeable Top Service slides (All Time/Top 3 This Week/Top 5 This Month)
- [x] Each KPI slide tap opens correct KPI detail page with correct filter
- [x] Add Payment Summary shortcut button to Calendar Unpaid filter banner
- [ ] Fix KPI detail sheet layout so content (charts, data) is fully visible when opened
- [ ] Wire each KPI slide to open the correct filtered view in the detail sheet

## Stripe Connect Integration (Option B — Hosted Checkout)

- [ ] DB schema: add stripeConnectAccountId, stripeConnectEnabled, stripeConnectOnboardingComplete to businessOwners
- [ ] DB schema: add stripePaymentIntentId, stripeCheckoutSessionId to appointments
- [ ] DB schema: add "card" to paymentMethod enum on appointments
- [ ] Server: create stripeConnectRoutes.ts with create-account, onboarding-link, account-status, dashboard-link, create-checkout-for-appointment endpoints
- [ ] Server: add webhook handlers for account.updated, checkout.session.completed (connect payments)
- [ ] Server: register stripeConnectRoutes in _core/index.ts
- [ ] Admin Panel: add Stripe Connect section — list all connected accounts, status, 1.5% platform fee config
- [ ] Business owner Settings: add "Accept Card Payments" section with Connect Stripe button, status badge, Stripe dashboard link
- [ ] Client booking flow: add Card Payment step using Stripe hosted Checkout, handle success/cancel deep link
- [ ] Appointment detail: show card payment badge when paymentMethod === "card"
- [ ] Calendar: add "Card" chip to payment method filter chips
- [ ] Payment Summary: add Card to method breakdown
- [ ] Stripe payout push notification — notify business owner when payout is initiated with amount and arrival date
- [x] Remove Next keyboard button on onboarding phone number screen (change to Done)
- [x] Restore logo image on animated splash screen
- [x] Pull-to-refresh on Payment Methods screen (refresh balance + payout data)
- [x] Separate detail pages for Zelle, Cash App, Venmo (description, input field, live QR preview, save button)
- [x] Client booking page: show only the selected payment method's QR code (not all three)
- [x] Onboarding: animated swipe-up hint below Continue button
- [x] Onboarding: auto-advance when phone number is fully entered
- [x] Onboarding: slide-left/slide-right transitions between all steps
- [x] Onboarding: back chevron + swipe-right gesture on OTP, business info, social phone steps
- [x] Onboarding analytics: track highest step reached in AsyncStorage with timestamp
- [x] Onboarding analytics: display drop-off data in settings/admin area
- [x] Fix: Text-outside-Text render error in onboarding ScrollView
- [x] Fix: Business info step not scrolling on onboarding
- [x] Wire Twilio Verify OTP into server send/check routes
- [x] Add OTP test panel to Admin screen
- [x] Fix: back from Business Info loops between OTP and Phone step due to auto-advance firing on pre-filled phone
- [x] Fix Admin Panel mobile responsiveness (phone screen layout/resolution issues)
- [x] Extend session duration to 150 days (admin panel cookie + session)
- [x] Audit and verify OTP send/verify flow end-to-end with Twilio Verify
- [x] Admin Panel: dark/light mode toggle in header with system-theme auto-detection
- [x] Admin login page: apply system-theme dark mode auto-detection
- [x] Audit all Admin Panel sections for correct data connections to live app
- [x] Fix Admin Panel dashboard stat cards grid — single column on mobile phones (< 480px)
- [x] Add OTP send/verify panel to Admin Panel Twilio section (send OTP to any number, verify code, show result)
- [x] Add OTP usage counter (Twilio usage records API) to Admin Panel Twilio section
- [x] Improve OTP send/verify feedback messaging — clear success/failure status with details
- [x] Add mobile back-to-top button (bottom-fixed) to Admin Panel for long pages
- [x] Add otp_send_log DB table and migration to store OTP send history
- [x] Add GET /api/admin/otp/log route returning last 10 OTP send log entries
- [x] Update OTP send route to write log entry (phone, status, error) on each send attempt
- [x] Add OTP log table HTML below the send panel in Platform Config page
- [x] Add 30-second resend cooldown on Send OTP button after successful send
- [x] Add missing Twilio Verify Service SID input field to Platform Config page (was causing OTP send to fail)
- [x] Fix testTwilio() and testStripe() JS crash — used outer `form` variable that could be null; now uses document.querySelector directly with null guard
- [x] Fix Send OTP button staying disabled after a failed send — re-enable button in the error branch
- [x] Add session keep-alive ping every 10 minutes on all admin pages to prevent silent session expiry
- [x] Fix login screen: remove empty gap between Continue button and "or continue with" divider
- [x] Fix login screen: center form content vertically on screen
- [x] Change "BY MANUS" to "BY INNOVANCIO" on onboarding/login screen
- [x] Smart greeting: show "Welcome back!" for returning users, "Get started" for first-time users (using AsyncStorage flag)
- [x] Add staggered fade-in + slide-up animation to tagline and "by Innovancio" text on onboarding screen load
- [x] Add separate slide-up fade-in animation to "Lime Of Time" app name to complete staggered entrance sequence
- [x] Add splash screen logo pulse/scale animation and fade transition before dismissing to onboarding screen
- [x] Fix Verify Service SID save/load in platform config (currently shows placeholder after save)
- [x] Fix Test Mode toggle — when OFF use real Twilio Verify, when ON use static OTP code
- [x] Add per-phone test mode override (specific numbers bypass Twilio, others get real OTP)
- [x] Fix app-side OTP send/verify to respect Test Mode setting from DB
- [x] Verify all Twilio connections end-to-end
- [x] Add "Clear All Overrides" button to Phone OTP Overrides table in Admin Panel
- [x] Add Twilio trial mode detection banner in Admin Panel (checks account type via API, prompts to add payment)
- [x] Add OTP verify input next to Send OTP panel in Admin Panel for full test loop
- [x] Fix broken regex /^\+[1-9]\d{6,14}$/ in platformConfigPage template literal (was /^+[1-9]d{6,14}$/ in HTML, causing JS syntax error that made all button functions undefined)
- [x] Add Test Connection auto-run on page load (testTwilio() called 800ms after page ready)
- [x] Add Stripe test-connection auto-run on page load (same pattern as Twilio testTwilio() auto-run)
- [x] Fix OTP send: ensure real Twilio SMS is sent when test mode is OFF
- [x] Fix test mode toggle: changes take effect immediately (invalidate cache on toggle)
- [x] Fix onboarding OTP screen: auto-fill OTP digits from SMS (SMS OTP autofill / one-time-code)
- [x] Fix onboarding OTP screen: digit-by-digit input fills all boxes correctly
- [x] Add Save & Test combined button for Twilio section in Admin Panel
- [x] Add Save & Test combined button for Stripe section in Admin Panel
- [x] Add audit log viewer in Admin Panel (filterable table by category/action/date)
- [x] Fix phone E.164 formatting bug: +1 country code dropped when building rawPhone for Twilio (sends "4124827733" instead of "+14124827733")
- [x] Test OTP send/verify end-to-end via API (E.164 fix verification)
- [x] Add Verify OTP test field in Admin Panel Platform Config (verify code without going through the app)
- [x] Fix onboarding Business Info step: full screen scrolls (not just inside white card), fields visible when keyboard opens
- [x] Fix onboarding OTP step: fields visible when keyboard opens, proper scroll behavior
- [x] Restore logo on OTP onboarding page (was removed by previous fix)
- [x] Fix Business Info step: make content scrollable all the way down
- [x] Add KeyboardAvoidingView offset tuning for Android (prevent keyboard overlapping bottom button)
- [x] Add inline validation feedback on Business Info fields (red border + error message while typing — already implemented)
- [x] Fix Business Information onboarding step: full-screen scroll like OTP page, logo visible
- [x] Fix Subscription onboarding step: full-screen scroll like OTP page, logo visible
- [x] Keep logo visible on ALL onboarding steps (do not hide it on any step)
- [x] Add Save & Test combined button for Twilio section in Admin Panel
- [x] Add Save & Test combined button for Stripe section in Admin Panel
- [ ] Fix Home page Status section: Week/Month/All tabs filter appointment counts correctly
- [ ] Fix Home page Status section: "View All" navigates to Calendar tab (not a different page)
- [ ] Fix Home page Status section: clicking a status row (Completed/Confirmed/Pending/Cancelled) navigates to Calendar tab with correct filter

- [ ] Add inline Accept/Decline notification action buttons (iOS/Android notification banner) for appointment_request and appointment_rescheduled notifications
- [ ] Verify Calendar tab red badge for pending requests is working correctly

- [x] Fix null workingHours crash in lib/types.ts (generateAvailableSlots now uses resolvedWorkingHours with != null guard)
- [x] Fix null workingHours crash in app/appointment-detail.tsx (reschedSlots useMemo)
- [x] Fix null workingHours crash in app/new-booking.tsx (5 occurrences of Object.keys(null) pattern)
- [x] Fix null workingHours crash in app/calendar.tsx (4 occurrences of Object.keys(null) pattern)
- [x] Fix Zelle QR broken image on booking page (use plain handle as QR value instead of zelle: scheme)
- [x] Card payment success page: retry up to 9s, show location and client name in receipt
- [x] Auto-mark appointment as paid when Stripe webhook fires (push notification + app auto-update)
- [x] Push notification deep-links to correct screens (appointment-detail, calendar, settings, subscription)
- [x] Inline Accept/Decline notification action buttons (categoryIdentifier: apptrequest)
- [x] Calendar tab red badge for pending requests
- [x] Fix hooks ordering crash in appointment-detail.tsx (early return was before 5 hooks)
- [x] Per-location QR codes in Settings > Locations screen
- [x] Sharing links/QR always use base URL (no ?location= param)
- [x] Location-first booking flow (step 0 = Location)
- [x] Persistent location banner on all booking steps
- [x] Auto-skip location step for single-location businesses

- [x] Add "Request Card Payment" button on appointment detail screen (visible when appointment is unpaid/skip-payment and Stripe is enabled)
- [x] Create server endpoint POST /api/stripe-connect/request-payment that generates a Stripe Checkout session for a specific appointment
- [x] Client-facing payment: Stripe-hosted Checkout page; on success redirects to existing booking receipt page (reused)
- [x] SMS the payment link to the client when owner taps "Request Card Payment" (Twilio server-side or native SMS fallback)
- [x] Stripe webhook auto-marks appointment as paid (card) and sends push notification to owner when client pays (reused existing webhook)
- [x] Show "Payment Requested" badge on appointment detail after link is sent (button changes to Resend)
- [x] Allow owner to resend payment link if client hasn't paid yet

- [x] Refund button on appointment detail for card-paid appointments (full + partial refund modal) — already existed
- [x] Payment link expiry handling: check if Stripe session is expired before Resend; create fresh session if so
- [x] Payment status polling: auto-refresh unpaid appointment status every 30s while owner is on detail screen

- [x] Audit 1.5% platform fee (application_fee_amount) on all Stripe Checkout sessions
- [x] Fix hardcoded fee — now reads from DB config key STRIPE_PLATFORM_FEE_PERCENT (admin-configurable)
- [x] Fix session-status endpoint — was using wrong field name (stripeAccountId vs stripeConnectAccountId)
- [x] Add fee logging to all three checkout flows (create-checkout, request-payment, no-show-fee)

- [x] Add card fee disclosure notice on public booking page (before payment step and on Stripe checkout)
- [x] Add "Test Fee" button in admin Stripe Connect dashboard
- [x] Add fee revenue dashboard in admin panel (stripe.applicationFees.list() by month)
- [x] Fix seed-reviews.ts TypeScript null check error

- [x] Stripe test mode toggle in admin Stripe Connect panel (one-click, warning banner when active)

- [x] Stripe key switcher: warn on test/live key mismatch when toggling mode, allow inline key update

- [x] Twilio credential validator: "Test Connection" button in Platform Config to verify SID + auth token — already existed

- [x] Fix location name overflowing out of appointment card on calendar screen

- [x] Fix "Invalid array" PaymentIntent bug in transaction suite test endpoint
- [x] Add webhook health check status indicator to admin Stripe Connect page

- [x] Add payment method badge (Card/Cash/Zelle) to appointment cards in calendar list
- [x] Auto-refresh webhook health check after tapping Register Webhook Automatically

- [x] Calendar: block booking and show setup banner with deep link to Add Location when no location is configured

- [x] Home screen: show no-location amber banner when no location is configured, deep link to /locations

- [x] Calendar: grey out and disable all days when no location is configured (appear as non-working days)

- [x] Calendar: disable Workday panel (greyed out, non-interactive) when no location is configured
- [x] Verified no-location amber banner on Home screen (already present in index.tsx)
- [x] Fixed card payment redirect bug: request-payment endpoint was using owner.slug (undefined) — now uses customSlug || businessName-derived slug
- [x] Fixed card payment redirect bug: success URL was using wrong query param payment_success=1 — now uses dedicated /api/payment-receipt/:slug?session_id= page
- [x] Added dedicated /api/payment-receipt/:slug page for owner-initiated card payment receipts — clean receipt page with no booking form flash
- [ ] Fix notification tap crash: Cannot read property 'toLowerCase' of undefined in types.ts:690 (appointment-detail.tsx:48)
- [ ] Fix client booking page redirect: after card payment still going back to step 1 instead of receipt page
- [ ] Fix appointment not updating to paid after Stripe webhook fires (still shows Mark as Paid instead of Refund)
- [x] Fix notification tap crash: guard against invalid date in generateAvailableSlots (types.ts + appointment-detail.tsx)
- [x] Fix client booking page redirect after card payment: skip auto-advance to step-1 when payment=success in URL
- [x] Fix appointment not showing Refund button after card payment: immediate DB check on mount + pre-update on notification tap
- [x] Reduce payment polling interval from 30s to 10s on appointment-detail screen
- [x] Add refund breakdown modal showing charge amount, Stripe fee estimate, and client receives amount
- [x] Smart cancellation for card-paid appointments: auto-refund on cancel, keep fee if cancellation policy applies
- [x] Separate Stripe charge for cancellation fee when client paid by card
- [x] Refund history badge on client profile appointment cards
- [x] Cancellation fee SMS to client (itemized fee charged + refund amount)
- [x] Stripe Payments audit trail tab in Settings (charges, refunds, payouts)
- [ ] Request-based cancellation: client requests cancel/reschedule instead of instant cancel
- [ ] Owner approves/declines cancel request with auto fee charge + partial refund
- [ ] Block cancellation for completed appointments on client booking page
- [ ] Pending request badge on owner appointment-detail screen
- [x] Request-based cancellation system: DB schema fields (cancelRequest, rescheduleRequest)
- [x] Server endpoints for request-cancel and request-reschedule
- [x] Client booking page: replaced instant cancel with Request Cancellation / Request Reschedule
- [x] Owner appointment-detail: pending request banner with Approve/Decline buttons
- [x] Smart fee+refund logic on cancellation approval (card-paid appointments)
- [x] Push notifications for cancel_request and reschedule_request to owner
- [x] Notification tap handler for cancel_request and reschedule_request types
- [ ] Remove phone number 4124827733 from business profile/DB
- [ ] Restrict Pay with Card to correct plan tier (not Solo/Growth)
- [ ] Add Requests filter tab to Calendar screen
- [ ] Add amber request badge on calendar appointment cards
- [ ] Pre-composed SMS for owner on Approve/Decline (no auto-send)
- [x] Remove phone number 4124827733 from DB and all code references
- [x] Restrict card/Stripe payments to Studio and Enterprise plans only
- [x] Show upgrade prompt on Payment Methods screen for Solo/Growth plans
- [x] Requests filter tab on Calendar (already existed, confirmed working)
- [x] Amber request badge on calendar appointment cards for pending cancel/reschedule requests
- [x] Pre-composed SMS prompt on appointment-detail after owner approves or declines a request
- [ ] Fix UPDATE_APPOINTMENT_STATUS tRPC sync error (network request failed)
- [ ] Request expiry: auto-decline after 24-48h and SMS client
- [ ] Client-facing request status page with withdraw option
- [ ] Bulk request review on Calendar Requests tab
- [x] Fixed requestExpiryCron.ts to use await getDb() correctly
- [x] Added withdraw-request endpoint in publicRoutes.ts
- [x] Added Withdraw Request button on client manage appointment page
- [x] Added expired/withdrawn status banners on client manage page
- [x] Added bulk Approve All / Decline All banner on Calendar Requests tab
- [x] Request history section on client manage appointment page
- [x] Configurable owner response window setting (12h/24h/48h/72h)
- [x] Revenue summary card on Home screen from Stripe balance
- [x] Push notification to owner when client submits cancel/reschedule request
- [x] Response window countdown timer on owner's pending-requests list
- [x] Add discountPercent field to subscriptionPlans DB schema for plan-level discounts
- [x] Add discountLabel field to subscriptionPlans DB schema (e.g. "Launch Special", "50% off first 3 months")
- [x] Update Admin Panel plan editor to show discount % and label fields
- [x] Update getPublicPlans to return discountPercent and discountLabel
- [x] Update stripeRoutes.ts create-checkout to apply discount: use discounted price as Stripe price unit_amount
- [x] Update choose-plan.tsx, onboarding.tsx, subscription.tsx to show discount badge when discountPercent > 0
- [x] Fix confirmation email in stripeRoutes.ts to use DB prices instead of FALLBACK_PRICES
- [x] Fix Subscription screen "Could not load subscription info" error
- [x] Add discountExpiresAt date field to subscriptionPlans DB schema
- [x] Update Admin Panel plan editor to show discountExpiresAt date picker
- [x] Wire discountExpiresAt auto-expiry: getPublicPlans returns 0% discount when expired
- [x] Fix Admin Panel Plan Pricing save button being disabled
- [x] Fix Subscription screen not opening from Settings Tools (added to Stack in _layout.tsx)
- [x] Verify DB update pipeline for plan pricing saves correctly
- [x] Fix discountExpiresAt input: change from datetime-local to date-only to avoid browser validation error
- [x] Restore dirty-check Save button: only enable when form values have changed
- [x] Fix duplicate push notifications: add deduplication/idempotency so each appointment+type fires only once
- [x] Fix notification tap opening same screen multiple times in navigation stack
- [x] Fix slow initial DB load (30-40 second delay for client data) — stale-while-revalidate: show AsyncStorage cache instantly, refresh from DB in background
- [x] Fix splash screen: delay Face ID prompt until after animated splash finishes (splashDone prop passed to AppLockProvider → useAppLock)
- [x] Fix Client screen: Birthday field label shows "Expire Date" instead of "Birthday" — fixed in birthday-picker.tsx, client-detail.tsx, clients.tsx
- [x] Remove "Expired" badge from client list cards (getExpireBadge was incorrectly treating birthday as an expiry date)
- [x] Fix Birthday Campaigns: clients disappear after tapping Send Message — root cause was birthday not saved to DB, now fixed via birthday column in DB + tRPC mutations
- [x] Fix birthday being cleared from client profile when returning from SMS app — added birthday column to DB schema, tRPC create/update schemas, and store sync calls
- [x] Redesign Service add/edit screen: professional layout, fix image preview (not cutting off, full preview)
- [x] Redesign Product add/edit screen: matching professional layout, fix image preview
- [x] Client Gift Portal: DB columns added to gift_cards table (purchaserName, purchaserEmail, recipientEmail, paymentMethod, paymentStatus, totalValue, purchasedPublicly, recipientChoosesDate, preselectedDate, preselectedTime)
- [x] Client Gift Portal: /api/public/business/:slug/gift-info endpoint (services, products, payment methods)
- [x] Client Gift Portal: POST /api/public/business/:slug/buy-gift endpoint (creates gift, sends confirmation emails)
- [x] Client Gift Portal: GET /api/public/gift-purchase/:code endpoint (gift details for confirm page)
- [x] Client Gift Portal: /api/buy-gift/:slug HTML page — 3-step gift purchase flow (pick items, enter info, pay)
- [x] Client Gift Portal: /api/gift-confirm/:code HTML page — confirmation + share link + payment instructions
- [x] Client Gift Portal: sendGiftNotificationEmail and sendGiftPurchaseConfirmationEmail added to email.ts
- [x] Client Gift Portal: "Buy a Gift" share banner added to gift-cards.tsx business app screen
- [x] Client Gift Portal: GiftCard type updated with new public gift fields
- [x] Test gift portal end-to-end: look up slug for business 4124827733, open buy-gift page, submit test purchase, verify emails
- [x] Add Public Gifts tab to Gift Cards screen: show publicly purchased gifts (pending payment, redeemed, expired) with mark-as-paid action
- [x] Add markAsPaid tRPC mutation to giftCards router
- [x] Update dbGiftCardToLocal to map new public gift fields (purchasedPublicly, purchaserName, paymentStatus, etc.)
- [x] Fix share link: point to main booking portal (/api/book/:slug) not directly to buy-gift page
- [x] Add "Book for myself / Buy a Gift" choice card on booking portal landing page (after location step)
- [x] Redesign buy-gift HTML page: mobile-first responsive, matching booking portal style (category tiles, service list rows, sticky footer, date toggle, step indicator)
- [x] Fix buy-gift URL not working: routes are live on local dev server; live site needs Publish to deploy new routes
- [x] Fix app booking date picker: replace 14-day horizontal strip with full monthly calendar grid showing all dates, with month/year header and prev/next navigation (90-day range)
- [x] Diagnose shared links: links work fine on local dev server; live site needs Publish to deploy new gift portal routes
- [x] Fix: auto-select single location in New Booking (no "Location Required" error when only 1 location)
- [x] Fix: calendar location filter — show all if multiple, show/preselect single if only one (via useActiveLocation hook)
- [x] Redesign date picker: modern horizontal scrolling strip with month label, wider chips, smooth scroll (62px wide chips, day/number/month, OFF/FULL badges, today dot)
- [x] Date picker: add "Today" jump button to scroll back to today's date chip
- [x] Date picker: show full date label (e.g., "Wednesday, April 30") above time slot grid
- [x] Date picker: auto-scroll to pre-selected date when arriving from calendar "Book Appointment"
- [x] Fix date strip scroll: selected chip appears as first visible chip from left (not hidden/cut off), works for any date including months ahead. Mount scroll is instant (animated: false), tap scroll is animated.
- [x] Fix "View Today" on Home screen: now passes date=todayStr + view=day + filter=today so calendar opens on today's date in day view with today's appointments visible
- [x] Replace horizontal date strip in new-booking Pick Date & Time step with a full monthly calendar grid (same style as Calendar tab) — prev/next month navigation, day-of-week headers, OFF/FULL badges, today dot, selected highlight
- [x] Fix reschedule calendar contrast: improve today highlight, past day visibility, and day header contrast
- [x] Fix Home page Status section tabs: extend rangeEnd to end of week/month for future appointments
- [x] Fix notification tap crash: add null guard for dayName2 in generateAvailableSlots (types.ts)
- [x] Fix client portal service images: only return photoUri if it is an HTTP/HTTPS URL
- [x] Fix client portal reschedule page: pass clientToday and nowMinutes to filter past time slots
- [x] Fix Choose Plan popup: increase card padding and margins for better spacing from screen edges
- [x] Fix New Service form: hide SMS Reminder Timing section when plan does not include SMS
- [ ] Fix /book/slug: open Location selection step first (not skip to Info step)
- [ ] Fix Book for Myself: navigate to normal booking flow as a new page (not append fields below)
- [ ] Fix Buy a Gift page: match regular portal design and load services/products from DB
- [ ] Test end-to-end: book appointment and buy a gift using business phone 4124827733

## Gift & Payment Features (Apr 30, 2026)

- [ ] Add Gifts tab to bottom navigation bar in the business dashboard
- [ ] Build recipient-facing gift redemption flow (public web page for booking with gift code)
- [ ] Add Stripe card payment to Buy a Gift page (create Stripe checkout session before confirming gift)
- [ ] Add Stripe gift payment webhook handler to mark gift as paid after Stripe checkout
- [ ] Audit and fix subscription plan enforcement across the app
- [ ] Fix all payment method connections (Zelle, Venmo, CashApp, Stripe) in gift and booking flows

## Calendar Booking Flow & Month Swipe Navigation

- [x] Calendar month view: swipe left/right to navigate months (gesture + prev/next buttons both work)
- [x] Calendar month view: show "Full" badge on days with no available slots, "Off" badge on closed/non-working days
- [x] Calendar day tap: inline time-slot expansion appears below selected day row (same page, no navigation)
- [x] Calendar day tap: "+Book Appointment" button appears when day has available slots
- [x] Calendar booking flow: after selecting time, show Continue button that opens new calendar-booking screen
- [x] Calendar booking flow Step 1: Service category → service selection (category tiles → service list → detail sheet)
- [x] Calendar booking flow Step 2: Client selection from client list (search + quick-add)
- [x] Calendar booking flow Step 3: Location selection (auto-preselect if single location or location clicked from calendar)
- [x] Calendar booking flow Step 4: Staff member selection filtered by chosen location with availability
- [x] Calendar booking flow Step 5: Confirm booking summary (date, time, service, client, location, staff, price)
- [x] Calendar booking flow Step 6: Send message option after confirmation
- [x] Calendar booking flow: pre-fill date and time from calendar selection (not editable in flow)
- [x] Calendar booking flow: completely separate from Home page New Booking flow (no changes to new-booking.tsx)

## Client Booking Portal Fixes (May 2026)

- [x] Fix service image in detail sheet — change from height:180px/cover to height:auto/contain so full image is visible
- [x] Replace broken Google Charts QR code with in-browser QR generation using qrcode.js CDN
- [x] QR codes now shown in a modal overlay — client taps Zelle/CashApp/Venmo button to open QR modal
- [x] Added openQrModal/closeQrModal JS functions with canvas-based QR generation
- [x] Added qrcode.js CDN script to booking page head
- [x] Added QR modal overlay HTML to booking confirmation page (step-8)

## Calendar Month View Enhancements (May 2026)

- [x] Show slot count badge ("3 left") on each day cell for days with remaining capacity
- [x] Show "No available slots" state in inline panel when a full day is tapped, with a "Next available: [date]" link

## Calendar & Booking Flow Improvements (May 2026)

- [ ] Calendar slot panel (All Locations mode): show location count badge under each time chip (e.g. "3 locations")
- [ ] Calendar-booking flow: fix client phone number format to (000) 000-0000
- [ ] Calendar-booking flow: service/product picker — collapsible categories (services) and brands (products), list hidden until category/brand tapped
- [ ] New-booking flow: service/product picker — same collapsible categories/brands UX as calendar-booking
- [ ] Continue button disabled until location selected when multiple locations available for chosen time (already done in new-booking.tsx)
- [x] Fix Week card height — all 7 days visible, card must not be cut off or overflow into next section
- [x] Smooth slide animation when swiping/navigating between days and weeks in Day/Week KPI card
- [x] Calendar page: add sticky day section headers (e.g. "May 1, 2026") to all appointment list tabs, hiding days with no appointments
- [x] Calendar day list: add "Mark Paid" button on each appointment card (same as Bookings page), toggles to green "Paid" badge after tapping; requires payment modal
- [x] Calendar day list: update date title format — show "Today, Sun, May 3" for today, "Monday, May 4" for other days (applies to month panel, day view, and week view titles)
- [x] Bookings page: add "Today" filter pill alongside Upcoming/Confirmed/Unpaid that filters list to today's appointments only
- [x] Public booking page: fix category card overflow — long category names (e.g. "Upper body: back/neck/shoulders/face") now wrap inside the card border on both Select Service (step 3) and Add More (step 6)
- [x] Public booking page: 2-line clamp with ellipsis on category tile names (step 3 and step 6) — names over 2 lines truncate with …
- [x] Category editor: live character counter on name input, turns amber at 20+ chars and red at 25+ chars with contextual warning message
- [ ] Category editor: replace native Alert.prompt rename with custom modal that has live character counter (amber at 20+, red at 25+)
- [ ] Public booking page: tooltip showing full category name on long-press for truncated tiles (step 3 and step 6)
- [ ] Category editor: emoji picker per category — tappable emoji button on each row opens curated picker; emoji stored in categoryEmojis map in settings DB and shown on booking page tiles

## Client Portal Restoration (from commit e4dac7c1)

- [x] Install expo-location package
- [x] Restore DB schema: clientAccounts, clientMessages, clientSavedBusinesses, servicePhotos tables + businessOwners lat/lng/businessCategory/clientPortalVisible
- [x] Run db:push to apply schema changes
- [x] Restore server/clientRoutes.ts (825 lines)
- [x] Restore client DB functions in server/db.ts
- [x] Register clientRoutes in server/_core/index.ts
- [x] Restore lib/client-store.tsx
- [x] Restore hooks/use-client-notifications.ts
- [x] Restore components/client-portal-background.tsx
- [x] Restore app/profile-select.tsx
- [x] Restore app/client-signin.tsx
- [x] Restore app/client-profile-onboarding.tsx
- [x] Restore app/(client-tabs)/_layout.tsx
- [x] Restore app/(client-tabs)/index.tsx (Home)
- [x] Restore app/(client-tabs)/discover.tsx
- [x] Restore app/(client-tabs)/bookings.tsx
- [x] Restore app/(client-tabs)/messages.tsx
- [x] Restore app/(client-tabs)/profile.tsx
- [x] Restore app/client-appointment-detail.tsx
- [x] Restore app/client-booking-wizard.tsx
- [x] Restore app/client-booking-confirmation.tsx
- [x] Restore app/client-business-detail.tsx
- [x] Restore app/client-edit-profile.tsx
- [x] Restore app/client-message-thread.tsx
- [x] Restore app/client-message-thread-business.tsx
- [x] Restore app/client-notifications.tsx
- [x] Restore app/client-saved-businesses.tsx
- [x] Update app/_layout.tsx: add ClientStoreProvider, anchor=profile-select, handleSplashFinish, client Stack.Screen entries
- [x] Restore staff Messages tab in app/(tabs)/clients.tsx
- [x] Update components/ui/icon-symbol.tsx with missing icons
- [x] TypeScript check passes
- [x] All tests pass

## Phase: Client Portal QA + Settings + Notifications (May 2026)
- [ ] Audit and fix client booking flow end-to-end (profile-select → sign-in → discover → booking wizard → confirmation → appointment detail)
- [x] Add clientPortalVisible toggle to Business Settings screen
- [x] Wire push notification deep-link: client_message type → navigate to client-message-thread-business screen
- [x] Wire push notification deep-link: business_message type → navigate to client-message-thread screen
- [ ] TypeScript check passes after all changes

## Phase: Bug Fixes + Client Portal Features (May 2026)

- [ ] Fix client sign-in "Failed to fetch" on web preview
- [ ] Fix Discover "No businesses found" - ensure clientPortalVisible businesses appear
- [x] Add appointment_confirmed push notification to client when business confirms
- [x] Wire servicePhotos to client business detail screen gallery
- [x] Add review prompt sheet after appointment completion in client portal
## Phase: Discover + Routing Fixes (May 2026)
- [x] Fix Discover zip code / city search: accept `q` or `search` param, geocode `location` param for zip/city
- [x] Fix Settings portal-visibility toggle to call geocoding endpoint (sets lat/lng so business appears in discovery)
- [x] Fix portal-visibility endpoint to also geocode location addresses as fallback
- [x] Fix startup routing flash: opaque overlay hides stale routes until splash finishes
- [x] Fix initial routing flash: app briefly shows last visited page before landing on profile-select/login (white flash / stale route on app open)
- [x] Fix "Failed to fetch" error on client profile onboarding Save & Continue
## Phase: Service Photos + Near Me + Notification Deep-links (May 2026)
- [x] Wire service photos to client business detail gallery screen (fix uri→url mapping + photos array parsing)
- [x] Add GPS "Near me" button on Discover screen to auto-fill location
- [x] Wire push notification deep-link: client_message type → navigate to client-message-thread-business (already working)
- [x] Wire push notification deep-link: business_message type → navigate to client-message-thread (already working)
- [x] Test client profile creation end-to-end and verify DB storage (phone login → PATCH → GET verified)

## Phase: Client Portal Login & Data Loading Fixes (May 2026)
- [x] Fix client portal login with phone 412-482-7733 (same as business owner phone - must not conflict)
- [x] Verify client account is separate from business owner account (different DB tables - confirmed)
- [x] Fix client appointments endpoint: match appointments by phone number correctly (confirmed working)
- [x] Fix client portal home: unwrap {appointments:[]} response shape, fix unread count field (count vs unreadCount)
- [x] Add /api/client/saved-businesses GET/POST/DELETE endpoints (slug-based, full business details)
- [x] Deploy all fixes to production (lime-of-time.com)
- [x] Ensure discover screen loads nearby businesses for logged-in client

## Phase: Discover Improvements & Failed to Fetch Fix (May 2026)
- [x] Fix "Failed to fetch" on client sign-in (production server)
- [x] Discover: sort by rating when no GPS available
- [x] Discover: persist last GPS coords in AsyncStorage for next launch
- [x] Discover: persist discoverCategory and discoverRadius across sessions

## Phase: Discover UX Polish (May 2026)
- [x] Show star rating badge on Discover business cards
- [x] Near Me button persists GPS coords to AsyncStorage
- [x] Add Recently Viewed horizontal scroll section on Discover

## Phase: Reviews & Rating (May 2026)
- [x] Add star rating row to client-business-detail.tsx
- [x] Create reviews DB table and migration (already existed)
- [x] Add POST /api/client/reviews endpoint (already existed)
- [x] Add GET /api/client/reviews/:businessId endpoint (already existed)
- [x] Recalculate avgRating on business after review submission (live from reviews table)
- [x] Show review prompt after completed appointment on client appointments screen
- [x] Add "Clear Recently Viewed" button to Discover screen

## Phase: Discover Redesign & UX (May 2026)
- [x] Make Discover the default landing tab (index 0) in client portal
- [x] Add compact "Next Appointment / Book Again" card at top of Discover screen
- [x] Change clientPortalVisible default to true for new businesses
- [x] Fix: all businesses with clientPortalVisible=true should appear (currently only 1)
- [x] Prevent duplicate reviews - show "Reviewed" badge if already submitted
- [x] Show client's own review highlighted at top of Reviews tab
- [x] Add review count badge to Reviews tab label
- [x] Improve Discover screen visual design with dark green animations
- [x] Fix Wellness Suite DB: enable clientPortalVisible + set Pittsburgh 15237 coords
- [x] Add dark green background animation to all client portal screens
- [x] Add service category chips to business detail Services tab
- [x] Add service images to Services tab cards
- [x] Add Write a Review button on business detail page
- [x] Add sort by Most Reviews on Discover
- [x] Improve Recently Viewed/Visited card design (more professional)
- [ ] Push notification after appointment completion (review prompt)
- [x] Center and evenly space Services/Staff/Hours/Reviews tab bar on business detail
- [x] Add full-screen image lightbox for service photos on business detail
- [x] Use app icon as fallback logo for businesses with no photo
- [x] Fix color consistency on business detail page (match dark green portal theme)
- [x] Business cover photo upload in Settings → Branding
- [x] Wire cover photo to business detail page banner
- [x] Service "No image" category icon placeholder
- [x] Staff card tap-to-expand with Book with Name button
- [x] Fix business detail page dark theme: white text, glass service cards, no scrollbar, dark sticky bar
- [x] Fix location display: single location prominent, multi-location sorted by distance, white text
- [x] Fix phone number formatting consistently across all client portal screens
- [x] Apply portal dark green theme to client-saved-businesses.tsx
- [x] Apply portal dark green theme to client-message-thread-business.tsx
- [x] Add promo code + discount step to client booking wizard
- [x] Polish confirmation page: show payment method, discount, gift card applied, add to calendar
- [x] Build client-buy-gift.tsx native 5-step gift card purchase screen
- [x] Wire Buy a Gift Card button to business detail page
- [x] Apply dark portal theme to all 7 booking wizard steps (white text, glass cards, no colors.*)
- [x] Show staff member photos in booking wizard staff selection step
- [ ] Fix appointment detail: add icons for duration/business/address, rename Location to Business, tappable address opens maps
- [ ] Replace gift card date step with real calendar (location selector, working-days, time slots)
- [ ] Wire two-way messaging: client and business owner share same DB threads
- [ ] Add Messages card to business owner Home page (3 recent conversations)
- [ ] Push notifications when client or business owner sends a message

## Phase: Messaging & Calendar Improvements (May 2026)
- [x] Fix appointment detail: add icons for duration/business/address, rename Location to Business, tappable address opens maps
- [x] Replace gift card date step with real calendar (location selector, working-days, time slots)
- [x] Wire two-way messaging: client and business owner share same DB threads (already wired via clientMessages table)
- [x] Add Messages card to business owner Home page (3 recent conversations with unread badges)
- [x] Fix Haptics import in client-message-thread-business.tsx
- [x] Fix business?.name → business?.businessName in client-business-detail.tsx gift card button

## Phase: Push Notifications & Payment Card (May 2026)
- [x] Wire client-side business_message push handler (open correct thread when tapped)
- [x] Server: trigger push to client when business owner sends a message (already done server-side, verified)
- [x] Server: trigger push to business owner when client sends a message (already done server-side, verified)
- [x] Send review prompt push to client after appointment is marked complete (server already sends push; client now auto-opens review modal via review=1 param)
- [x] Add Paid/Unpaid payment breakdown card to business owner Home screen (PaymentSummaryCard already present with full breakdown)

## Phase: Unread Message Badge on Clients Tab (May 2026)
- [x] Build shared unread message count hook (polls /api/business/messages/unread-count every 30s)
- [x] Wire unread count badge to Clients tab bar icon (shows count, caps at 99+)
- [x] Badge clears when owner opens Messages tab (server marks threads as read on fetch)

## Phase: Public Booking Page Location Step Improvements

- [ ] Make location cards clickable with visual selection (green border + checkmark on selected card)
- [ ] Hide address from top business info card when multiple locations exist (keep phone only)
- [ ] Single location: auto-select and skip location step entirely (go straight to Step 2)
- [ ] Support ?location=<id> URL param to pre-fill location and skip selector
- [ ] Surface per-location booking URLs in Settings > Locations screen in the mobile app
- [x] Always open Portal Selector on cold launch (fix Expo Go last-page issue)
- [x] Business portal: require Face ID re-auth if last activity > 24 hours ago
- [x] Client portal: auto-logout after 30 days of inactivity
- [x] Profile-select: show quick-login button for returning business/client users instead of auto-routing
- [x] Extend Face ID to client portal with 24h re-auth toggle in client settings
- [x] Show "Welcome back" business name hint on Portal Selector for returning business owners
- [x] Add Sign Out button in business Settings screen (already existed — verified)
- [x] Client detail: add Call button (Linking tel:), edge-to-edge button row, haptics on all action buttons
- [x] Client detail: show "Add phone to unlock Call & Message" hint when client has no phone
- [x] Fix crash in client-booking-wizard.tsx: null serviceIds on discounts causing crash after cash payment
- [x] Booking wizard: always start at service selection (not staff) regardless of pre-selected service
- [x] Booking wizard service step: category filter pills already implemented (verified)
- [x] Business detail hero: extend banner image to fill blue gap at top (no color gap above photo)
- [x] Client home Book Again card: show business logo + name + last service + last visited + Book Again button
- [ ] Pre-splash screen: replace logo with green background + small loading spinner
- [ ] Fix SplashScreen.show error on Expo Go
- [ ] Booking wizard service cards: add service photos with tap-to-preview
- [ ] Fix blue/dark gap at top of booking wizard screen

## Phase: Gift, Package & Inbox Improvements (May 2026)
- [x] Business inbox unread badge — red dot/count badge on Messages tab when there are unread client messages (already implemented via useBusinessUnreadCount hook + tab badge)
- [x] Package expiry enforcement — expiryDays field on packages, expiresAt computed on purchase, booking blocked with "Package expired" alert if expired
- [x] Gift certificate balance display — remaining balance bar on client home screen gift cards ($X of $Y remaining)
- [x] Gift data clarification — strip GIFT_DATA blob from visible message, show clean data in UI
- [x] Balance Credit gift type — business can set a dollar amount gift (no specific service), client can apply it to any service at checkout
- [x] Gift code entry UI in booking wizard promo step — client can enter gift certificate code to apply to booking

## Phase: Gift, Package & Inbox Improvements (May 2026)
- [x] Business inbox unread badge — red dot/count badge on Messages tab when there are unread client messages
- [x] Package expiry enforcement — expiryDays field on packages, expiresAt computed on purchase, booking blocked with "Package expired" alert if expired
- [x] Gift certificate balance display — remaining balance bar on client home screen gift cards ($X of $Y remaining)
- [x] Gift data clarification — strip GIFT_DATA blob from visible message, show clean data in UI
- [x] Balance Credit gift type — business can set a dollar amount gift (no specific service), client can apply it to any service at checkout
- [x] Gift code entry UI in booking wizard promo step — client can enter gift certificate code to apply to booking

## Phase: Branding, Gift & Package Enhancements (May 2026 Session 2)
- [x] Splash screen fix — rebuilt AnimatedSplash with branded logo, app name "Lime Of Time", tagline, and smooth fade-in animation; navigates to Portal Selector after animation
- [x] Gift card image upload — business can upload a custom banner image when creating gift cards; banner shown on client home screen gift cards and confirmation screen
- [x] Package expiry reminder — in-app warning banner on client home screen when package expires within 7 days; amber border highlight and "Expires in X days" message
- [x] Balance gift partial redemption display — Promo step shows remaining balance after applying a balance-type gift code ("Using $X.XX — $Y.YY balance remaining")

## Phase: Gift Card Tap-to-Book Flow (May 2026 Session 3)
- [x] Add serviceLocalId to my-gifts API endpoint response
- [x] Add serviceLocalId to GiftCertificate interface in client home screen
- [x] Make entire gift certificate card tappable (AnimCard wrapper with haptic feedback)
- [x] Pass serviceLocalId (or preServiceName fallback) + preGiftCode to booking wizard on tap
- [x] Auto-validate gift code when client reaches Promo step (no manual Apply needed)
- [x] Update "How to use" instructions to reflect new tap-to-book flow

## Phase: Back-to-Gift Navigation Shortcut (May 2026 Session 4)
- [x] Write scroll_to_gifts_on_focus flag to AsyncStorage when back is pressed from gift-started wizard
- [x] On client home screen focus, check AsyncStorage flag and scroll to the gift certificates section
- [x] Capture gifts section Y position via onLayout for accurate scroll target
- [x] Smooth animated scroll with 350ms delay to let screen render first

## Phase: Splash Screen Startup Fix (May 2026)

- [x] Move SplashScreen.hideAsync() from onLayout to useEffect with 2 rAF delay so AnimatedSplash is painted first
- [x] Fix handleSplashFinish to navigate to /profile-select BEFORE setSplashDone(true) to prevent last-page flash
- [x] Remove redundant blocking overlay from inside content tree — AnimatedSplash already covers everything
- [x] Verify native splash background is #0D2318 (already correct in app.config.ts)

## Phase: Biometric Auto-Login + Splash Branding (May 2026)

- [x] Add "by Innovancio" line below tagline on AnimatedSplash screen
- [x] Biometric auto-login: logic already existed in handleSplashFinish — fixed critical bug where setSplashDone(true) was never called on the early-return path
- [x] If business owner has valid token + was recently active + Face ID enabled, skip Portal Selector and navigate directly to business dashboard
- [x] Show Face ID prompt immediately on dashboard arrival (AppLockProvider already handles this)

## Phase: Messaging & Notifications Batch (May 2026)

- [x] SMS Reminders toggle: default to OFF for new accounts
- [x] Messages list: sort threads newest-first (most recent message at top)
- [x] Messages list: allow client to swipe-to-delete or long-press to delete/archive a chat thread
- [x] Messaging thread header: show business logo avatar next to business name
- [x] Booking wizard: move Promo step BEFORE Payment step for all flows (single service, packages, gift)
- [ ] Packages: sync ADD_PACKAGE / UPDATE_PACKAGE / DELETE_PACKAGE to service_packages DB table
- [ ] Packages: add public API endpoint GET /api/public/business/:slug/packages
- [ ] Packages: show Packages & Bundles section in booking wizard service step
- [ ] Packages: when package selected, lock out individual service selection
- [ ] Packages: multi-session date picker with buffer-enforced pre-selected next available date
- [ ] Packages: date-aware discount application per session
- [ ] Packages: confirmation screen shows all sessions with full package price breakdown
## Phase: Startup Flash Fix + New Features (May 2026)
- [x] Fix startup flash: reset navigation to profile-select immediately on mount to prevent stale Expo Router state from showing client profile before portal selector
- [ ] Packages & Bundles in booking wizard: add Packages tab in service selection step with multi-session date picker
- [ ] Payment step price breakdown: show itemized summary (service price, promo/gift discount, final amount due)
- [ ] Restore deleted threads: add "Restore" option in messages screen to un-hide deleted conversations

## Phase: Full Parity + New Features (May 2026)

- [ ] Multi-session date picker for packages in mobile booking wizard (buffer enforcement)
- [ ] Payment confirmation number validation with per-method format hints in mobile booking wizard
- [ ] Unread badge on Messages tab icon
- [ ] Web booking page: add payment method selection step + confirmation number + itemized price breakdown
- [ ] Gift purchase page: add confirmation number field with per-method format hints
## Phase: Mobile Service Enhancements (May 2026)
- [x] Split address fields: Street Address, City, State, ZIP (stored concatenated, displayed separately)
- [x] Staff step moved after Location step in all booking flows
- [x] Staff filtered by selected location (only show staff assigned to that location)
- [x] Mobile service: staff selection step included in mobile booking flow
- [x] Service form: category as scrollable chips (not grid), with mobile service categories
- [x] Service form: In-Store/Mobile toggle at top, conditional fields per type
- [x] Service form: maxTravelDistance field for mobile services
- [x] Client booking wizard: split address fields (Street, City, State, ZIP)
- [x] Client booking wizard: travel zone guard using Nominatim geocoding
- [x] Confirmation page: show full formatted address for mobile bookings
- [x] DB schema: add maxTravelDistance column to services table
- [x] Mobile service catalog: popular categories (Car Detailing, Mobile Massage, etc.)
- [x] Pay on Behalf of Client button on appointment detail — opens native Stripe payment sheet, shows success confirmation, marks appointment as paid by card
- [x] Show 'Pay on Behalf of Client' button for all unpaid appointments regardless of plan or Stripe connection status
- [x] Booking wizard: Location always shown as step 2, Staff as step 3; staff list filtered by selected location
- [x] Booking wizard: Auto-advance past Location step for single-location businesses (300ms delay then jump to Staff)
- [x] Booking wizard: Show location address below location name on Location step cards (already present, confirmed)
- [x] Booking wizard: Filter time slots by selected location (cache invalidated on location change; API already location-aware)
- [x] Booking wizard: Redeem Gift now lands on Location step (step 1) instead of jumping to Staff step, so client picks branch first before proceeding
- [x] Booking wizard: Bypass Payment step when gift fully covers the booking (Amount Due = $0.00); auto-mark as free/paid
- [x] Booking wizard Confirm step: Show '🎁 Fully covered by gift — No payment needed' green banner when gift covers 100% of total
- [x] Client Bookings screen: Show '🎁 Gift — Fully Covered' green badge on appointment cards for $0 gift-covered bookings
- [x] Booking wizard Payment step: Show prominent '🎁 Gift Applied — $X off / Remaining: $Y' banner at top when gift partially covers the total
- [x] Client business detail: Convert from fullScreenModal to formSheet (slide-up bottom sheet) with drag handle and swipe-to-dismiss
- [x] Business detail: Remove leftover drag handle pill from loading state
- [x] Business detail: Fix sticky bottom bar safe area (home indicator)
- [x] Business detail: Per-service Book button now lands on Location step (step 1) with service pre-selected
- [x] Business detail: Book an Appointment button opens wizard at step 0 (Service selection)
- [x] Booking wizard: Fix category filter chips (replaced horizontal ScrollView with wrapping View to fix iOS touch conflict)
- [x] Booking wizard: Service thumbnail shown in header when service is pre-selected (steps > 0)
- [x] Booking wizard: 'Change service' link added on Location step
- [x] Booking wizard: Fix Address step Continue button hidden behind keyboard — moved bottomAction inside KeyboardAvoidingView
- [ ] Booking wizard: Auto-dismiss keyboard on Continue (Keyboard.dismiss() in handleNext)
- [ ] Booking wizard: Google Places address autocomplete on Address step
- [ ] Booking wizard: Save address to client profile checkbox after booking
- [x] Booking wizard: Auto-dismiss keyboard on Continue (Keyboard.dismiss in handleNext)
- [x] Booking wizard: Address autocomplete using OpenStreetMap Nominatim API
- [x] Booking wizard: Save address to profile checkbox on Confirm step

- [x] Fix Stripe Connect onboarding HTTPS error — use business sandbox test keys for Connect OAuth flow in test mode
- [x] Add step-by-step Stripe account creation guide on Payment Methods page
- [x] Lock Stripe card payment option behind subscription tier with upgrade prompt (already implemented)
- [x] Fix Stripe payment sheet using wrong key — STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY updated to test values in DB; create-payment-sheet endpoint now returns pk_test_51TVjfG9... (business sandbox key)
- [x] Fix staff members not showing on public booking page for non-seed services — renderStaffForService() now checks if any staff member is assigned to the service; if none are, all staff are shown (no over-filtering)
- [x] Fix review notification spam — "How was your visit?" push sent for every past appointment at once when auto-complete fires on app launch. Added reviewNotifSentAt column to appointments table; routers.ts now checks this flag before sending the push/in-app message. Backfilled all 733 existing completed appointments so they won't re-trigger.
- [x] Fix notification bell: tapping removes notification from list, badge count updates
- [x] Remove Book button from client detail page
- [x] Rename Messages tab/button to Remind on client detail page
- [x] Upgrade ⚡ template picker: use reminder templates with appointment selector and auto-fill
- [x] Fix clientReminderCron: exact ±15min window for 24h and 1h reminders with full location/phone details
- [x] Make message content clickable: phone→call, address→maps, date→native calendar
- [x] Fix send button hidden by keyboard on iOS and Android in messaging thread
- [x] Add portal delivery status indicator (✓ In-App / SMS only) on Remind button
- [x] Fix template variable substitution in messaging thread (raw {service}/{time}/{location} shown instead of real values)
- [x] Fix clientAppointments lookup to match by name fallback when clientId doesn't match
- [x] buildTplVars no longer returns null - uses clientName from route params as fallback
- [x] Fix messaging thread input bar: restore send button and ⚡ button (single-row iMessage-style layout)
- [x] Fix keyboard covering input bar on iOS and Android
- [x] Fix ⚡ template picker: deduplicate templates and organize by category (Upcoming, Confirmed, Completed, Follow-up, etc.)
- [x] Add smart client filter chips to Clients screen: All, Upcoming, Pending, Payment Required, Completed
- [x] Each filter shows targeted action buttons (Send Reminder, Send Payment Link, Send Review Request, Come Back Soon)
- [x] Fix "Selected time slot is no longer available" error on booking confirmation (interval mismatch + missing clientToday/nowMinutes in POST body)
- [x] Fix multi-service selection on public booking page (checkboxes, multi-toggle, updated totals, extraItems in POST)
- [x] Fix Packages auto-delete bug (syncToDb not called in packages.tsx)
- [x] Add 3 Packages to Lime Cut & Wellness DB (Hair + Nails + Wellness bundles)
- [x] Step 3: Category-grouped selected services panel with remove button and total time/price
- [x] Step 5 (Extras): Products only, skip step if no products available
- [x] Step 8 (Confirm): Each service/product as separate line item with name, category, duration, price
- [x] Gift and Book an Appointment flows now slide up from bottom (modal presentation with swipe-down-to-dismiss)
- [x] Added drag handle indicator to both client-buy-gift and client-booking-wizard screens
- [x] Add delete-for-me message feature for both Business and Client portals
- [x] Fix message bubble clipping (maxWidth on Pressable wrapper, not msgBubble style)
- [x] Fix template placeholder substitution when no appointment selected (business name, phone, booking/review URLs, fallbacks for service/time/location)
- [x] Add state to handleSelectReminderTemplate useCallback dependency array
- [x] Add search bar to Messages tab in Clients screen (filter by client name or message content)
- [x] Unread message badge already on Clients tab via useBusinessUnreadCount hook (confirmed working)
- [x] Add public API endpoint for packages: GET /api/public/business/:slug/packages
- [x] Add Packages & Bundles section to public booking page service selection step
- [x] Package selection sets duration = sessionDurationMinutes * totalSessions for calendar slot blocking
- [x] Package booking POSTs with package name in notes, correct duration, and price
- [x] Package booking receipt shows savings badge and original price
- [x] Fix multi-service selection on public booking page (currently only allows single service selection via modal)
- [x] Remove clickable address/phone links from location selection cards (keep only on top business info card)
- [ ] Add /book/:slug route (without /api prefix) so lime-of-time.com/book/business-name works directly
- [x] Add "Balance" tab to Buy a Gift page items step (preset amounts + custom input)
- [x] Wire balance gift type into gift data for downstream Details → Payment steps
- [x] Enforce $10 minimum balance amount on Buy a Gift Balance tab (front-end + server-side)
- [x] Add Package gift type to mobile app Buy a Gift screen (show package list, skip Date/Staff, recipient chooses sessions)
- [x] Add configurable minimum gift card balance amount to business settings page (default $10)
- [x] Wire configurable minimum from DB into server-side validation and front-end Buy a Gift Balance tab
- [ ] Fix package appointment: "0 min total" should show correct duration
- [ ] Fix package appointment: "Session 0 of 3" should start at 1
- [ ] Add inline expandable sessions accordion on appointment detail (business + client portal)
- [ ] Sessions accordion shows each session's date, time, location, staff, and status (completed/upcoming)
- [ ] Sessions accordion shows progress summary: "1 completed · 2 to go"
- [x] Fix package appointment: "0 min total" → correct duration using appointment.duration fallback
- [x] Fix package appointment: "Session 0 of 3" → "Session 1 of 3" (1-based counter)
- [x] Add inline expandable sessions accordion to business portal appointment detail
- [x] Add inline expandable sessions accordion to client portal appointment detail
- [x] Server: include packageSiblings in GET /api/client/appointments/:id response

- [x] Package progress pill ("2/3") on appointment cards in the calendar/list view (business portal)
- [x] Auto-SMS via Messaging system when business owner marks a package session as "Completed" — pre-generated message like "Session 1 of 3 complete — 2 sessions remaining on your Glow & Go Bundle."
- [x] Fix auto-reminder messages to use full professional format (Dear {clientName}, service, date, time, location, pricing, business name, phone, footer) matching manual send
- [x] Package session timeline strip (visual dots ✅ ✅ ⬜) at top of appointment detail screen (owner portal)
- [x] Client portal package progress dots on appointment cards (bookings tab)
- [x] Package-aware review push notification on final session completion ("How was your Glow & Go Bundle?")
- [x] Fix package card price clipping (check circle badge was overlapping the price text)
- [x] Add service images to package cards (package photoUri + fallback to first service photo)
- [x] Fix owner-side booking package cards: same image + price layout fix
- [x] Enlarge KPI numbers on business portal home screen (make main stat numbers bigger and bolder)
- [x] Restore animated logo splash screen (currently showing solid green screen, no animation)
- [x] KPI card minHeight 155→170 for breathing room on smaller phones
- [x] KPI sublabel font size 10→11px
- [x] Remove Messages preview section from home screen (keep floating chat bubble only)
- [x] Gift Cards redesign: two tabs (Issued / Sold), filter chips (All/Active/Redeemed/Unpaid/Expired), bottom sheet editor for owner edits on both tabs
- [x] Redesign business onboarding subscription page: modern professional layout, all info visible, same colors, all functions intact
- [x] Fix scroll-from-middle issue on Business Info onboarding page
- [x] Fix scroll-from-middle issue on Subscription/choose-plan onboarding page
- [x] Subscription page redesign v2: horizontal swipe carousel, full-gradient cards per plan, nav arrows, dots, compare modal (no auto-scroll, no free trial badge, no testimonials)
- [x] Fix Text strings outside Text component console error (bare $ in billedNote JSX)
- [x] Redesign plan-carousel.tsx: clean professional dark cards, no glow rings/scan lines/corner brackets, full-height layout, CTA always visible
- [x] Update choose-plan.tsx to use dark futuristic full-screen background (forced dark regardless of system theme)
- [ ] Fix subscription onboarding: same green gradient background, no rocket emoji, clean centred professional cards
- [ ] Add haptic feedback on plan carousel swipe
- [ ] Device calendar sync service (lib/calendar-sync.ts): get-or-create Lime Of Time calendar, add/delete events
- [ ] Calendar Sync toggle in Settings screen with bulk-sync on enable
- [ ] Wire calendar sync to appointment accept/cancel flows
- [ ] Add expo-calendar plugin to app.config.ts
- [ ] 14-day Stripe trial for paid plans (Growth, Studio, Enterprise): trial_period_days:14 in checkout
- [ ] Detect existing trial on re-subscription (one trial per customer, no repeat)
- [ ] Trial countdown banner on dashboard (amber, tappable to subscription settings)
- [ ] Auto-downgrade to Solo on payment failure after trial ends with push notification
- [x] Fix subscription onboarding: same green gradient as other steps, no rocket emoji, clean professional header
- [x] Add haptic feedback on plan carousel swipe (Light impact)
- [x] Implement device calendar sync service (lib/calendar-sync.ts) — Lime Of Time calendar, add/delete events
- [x] Add Calendar Sync toggle to Settings screen (Comms tab)
- [x] Wire calendar sync to appointment accept/cancel flows in bookings.tsx
- [x] Add expo-calendar plugin to app.config.ts (already present)
- [x] Add hasUsedTrial column to businessOwners DB table
- [x] Stripe 14-day trial: trial_period_days:14 for first-time paid subscribers
- [x] Stripe webhook: set subscriptionStatus=trial + trialEndsAt on checkout complete
- [x] Stripe webhook: trial→active transition on customer.subscription.updated
- [x] Stripe webhook: auto-downgrade to Solo after 3 failed payment retries
- [x] Trial countdown banner on dashboard (amber, tappable, shows days remaining)
- [x] Fix calendar-to-Available-Times spacing in client booking wizard date/time step
- [x] Fix "Book This Package" button to open booking wizard at Location tab (step 2) instead of Service step
- [x] Fix staff members not visible in booking wizard Staff step (step 3) even when they have availability
- [x] Client messages: tappable address (opens Maps), phone (opens dialer), date/time (adds to calendar)
- [x] Client messages: tappable address (opens Maps), phone (opens dialer), date/time (adds to calendar)
- [x] Package booking confirmation: add summary card showing package name, sessions count, and total price
- [x] Remaining sessions badge on package confirmation card (Session X of Y)
- [x] My Packages tab in client portal with session history per package
- [x] Fix duration display in booking page (show "1 hr 30 min" instead of decimal hours)
- [x] Fix package/bundle images not showing in booking service selection step
- [x] Fix session stepper circles overflowing the container when package has many sessions (e.g. 10)
- [x] Fix no available time slots showing in client public booking when selecting dates for package sessions (race condition fix: calendar now waits for working days to load)
- [x] Fix Home page share button sending wrong location address (sends first location instead of the selected/active location, and missing ?location= param in URL)
- [x] Add multi-step account deletion confirmation with full risk disclosure, typed confirmation, and complete image/data cleanup from cloud storage
- [x] Add emoji picker for custom service name creation in service form
- [x] Implement 30-day grace period for account deletion (pending deletion state, confirmation email, cancel option)
- [x] Add admin notification email when a business account is deleted
- [x] Add daily deletion cron job that auto-executes account deletion when 30-day grace period expires
- [x] Add admin dashboard at /admin/pending-deletions with secret token protection, listing grace-period accounts with manual cancel/execute override buttons
- [x] Add audit log entries to adminAuditLog table when admin manually cancels or executes deletion from pending-deletions dashboard
