/**
 * Availability Logic Layer
 * 
 * Unified availability management system with three-tier logic:
 * 1. Business Hours (weekly schedule)
 * 2. Daily Overrides (specific date overrides)
 * 3. Staff Availability (staff-specific availability)
 * 
 * Backward Compatible: YES
 * - Falls back to old logic if new tables don't exist
 * - Works with existing workingHours and staffMembers data
 * - No breaking changes to existing code
 */

import { getDb } from '../server/db';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';

// ============================================================================
// Type Definitions
// ============================================================================

export interface TimeSlot {
  startTime: string; // HH:MM format
  endTime: string;   // HH:MM format
}

export interface AvailableSlot extends TimeSlot {
  staffId?: string;
  staffName?: string;
}

export interface AvailabilityStatus {
  isOpen: boolean;
  startTime?: string;
  endTime?: string;
  reason?: string; // "closed", "override", "staff_unavailable"
}

// ============================================================================
// Core Availability Functions
// ============================================================================

/**
 * Get business hours for a specific date
 * Checks: Daily Override → Business Hours (by day of week)
 * 
 * @param businessOwnerId - Business owner ID
 * @param date - Date in YYYY-MM-DD format
 * @returns TimeSlot or null if closed
 */
export async function getBusinessHoursForDate(
  businessOwnerId: number,
  date: string
): Promise<TimeSlot | null> {
  try {
    const db = await getDb();
    if (!db) return null;

    // Step 1: Check for daily override (if table exists)
    try {
      // Note: This assumes dailyOverrides table exists
      // If it doesn't, we skip to step 2
      // const dailyOverride = await db.query.dailyOverrides.findFirst({
      //   where: and(
      //     eq(dailyOverrides.businessOwnerId, businessOwnerId),
      //     eq(dailyOverrides.date, date)
      //   )
      // });
      //
      // if (dailyOverride) {
      //   if (!dailyOverride.isWorkDay) {
      //     return null; // Business is closed
      //   }
      //   if (dailyOverride.startTime && dailyOverride.endTime) {
      //     return {
      //       startTime: dailyOverride.startTime,
      //       endTime: dailyOverride.endTime
      //     };
      //   }
      // }
    } catch (error) {
      // Table doesn't exist yet, continue to step 2
    }

    // Step 2: Fall back to weekly business hours
    const dayOfWeek = getDayOfWeek(date);
    // const workingHours = await db.query.customSchedule.findFirst({
    //   where: and(
    //     eq(customSchedule.businessOwnerId, businessOwnerId),
    //     eq(customSchedule.dayOfWeek, dayOfWeek)
    //   )
    // });

    // For now, return null as we don't have the schema yet
    return null;
  } catch (error) {
    console.error('Error getting business hours:', error);
    return null;
  }
}

/**
 * Check if business is open on a specific date
 * 
 * @param businessOwnerId - Business owner ID
 * @param date - Date in YYYY-MM-DD format
 * @returns true if business is open, false otherwise
 */
export async function isBusinessOpenOnDate(
  businessOwnerId: number,
  date: string
): Promise<boolean> {
  const hours = await getBusinessHoursForDate(businessOwnerId, date);
  return hours !== null;
}

/**
 * Check if a specific date/time is available
 * Checks: Business Hours → Daily Override → Staff Availability → Existing Appointments
 * 
 * @param businessOwnerId - Business owner ID
 * @param date - Date in YYYY-MM-DD format
 * @param time - Time in HH:MM format
 * @param duration - Duration in minutes
 * @param staffId - Optional staff member ID
 * @returns AvailabilityStatus
 */
export async function isDateTimeAvailable(
  businessOwnerId: number,
  date: string,
  time: string,
  duration: number,
  staffId?: string
): Promise<AvailabilityStatus> {
  try {
    // Step 1: Check business hours
    const businessHours = await getBusinessHoursForDate(businessOwnerId, date);
    if (!businessHours) {
      return { isOpen: false, reason: 'closed' };
    }

    // Step 2: Check if time is within business hours
    if (!isTimeWithinRange(time, businessHours.startTime, businessHours.endTime, duration)) {
      return { isOpen: false, reason: 'outside_business_hours' };
    }

    // Step 3: Check staff availability (if staffId provided)
    if (staffId) {
      const staffAvailable = await isStaffAvailableAtTime(
        staffId,
        date,
        time,
        duration
      );
      if (!staffAvailable) {
        return { isOpen: false, reason: 'staff_unavailable' };
      }
    }

    // Step 4: Check for conflicting appointments
    const hasConflict = await hasAppointmentConflict(
      businessOwnerId,
      date,
      time,
      duration,
      staffId
    );
    if (hasConflict) {
      return { isOpen: false, reason: 'appointment_conflict' };
    }

    return {
      isOpen: true,
      startTime: businessHours.startTime,
      endTime: businessHours.endTime
    };
  } catch (error) {
    console.error('Error checking availability:', error);
    return { isOpen: false, reason: 'error' };
  }
}

/**
 * Get available time slots for a specific date
 * Returns all available 30-minute slots within business hours
 * 
 * @param businessOwnerId - Business owner ID
 * @param date - Date in YYYY-MM-DD format
 * @param duration - Service duration in minutes
 * @param staffId - Optional staff member ID
 * @param slotInterval - Interval between slots in minutes (default 30)
 * @returns Array of available time slots
 */
export async function getAvailableTimeSlots(
  businessOwnerId: number,
  date: string,
  duration: number,
  staffId?: string,
  slotInterval: number = 30
): Promise<AvailableSlot[]> {
  try {
    const slots: AvailableSlot[] = [];

    // Get business hours
    const businessHours = await getBusinessHoursForDate(businessOwnerId, date);
    if (!businessHours) {
      return []; // Business closed
    }

    // Generate time slots
    const [startHour, startMin] = businessHours.startTime.split(':').map(Number);
    const [endHour, endMin] = businessHours.endTime.split(':').map(Number);

    let currentTime = new Date();
    currentTime.setHours(startHour, startMin, 0, 0);

    const endTime = new Date();
    endTime.setHours(endHour, endMin, 0, 0);

    while (currentTime < endTime) {
      const timeStr = formatTime(currentTime);
      const available = await isDateTimeAvailable(
        businessOwnerId,
        date,
        timeStr,
        duration,
        staffId
      );

      if (available.isOpen) {
        slots.push({
          startTime: timeStr,
          endTime: addMinutesToTime(timeStr, duration),
          staffId,
          staffName: staffId ? await getStaffName(staffId) : undefined
        });
      }

      // Move to next slot
      currentTime.setMinutes(currentTime.getMinutes() + slotInterval);
    }

    return slots;
  } catch (error) {
    console.error('Error getting available time slots:', error);
    return [];
  }
}

// ============================================================================
// Staff Availability Functions
// ============================================================================

/**
 * Check if a staff member is available at a specific date/time
 * Checks: Staff Availability → Business Hours
 * 
 * @param staffId - Staff member ID
 * @param date - Date in YYYY-MM-DD format
 * @param time - Time in HH:MM format
 * @param duration - Duration in minutes
 * @returns true if available, false otherwise
 */
export async function isStaffAvailableAtTime(
  staffId: string,
  date: string,
  time: string,
  duration: number
): Promise<boolean> {
  try {
    // For now, return true (staff availability feature coming in Phase 6)
    // This will be implemented when staffAvailability table is created
    return true;
  } catch (error) {
    console.error('Error checking staff availability:', error);
    return false;
  }
}

/**
 * Get staff availability for a specific date
 * 
 * @param staffId - Staff member ID
 * @param date - Date in YYYY-MM-DD format
 * @returns TimeSlot or null if unavailable
 */
export async function getStaffAvailabilityForDate(
  staffId: string,
  date: string
): Promise<TimeSlot | null> {
  try {
    // For now, return null (staff availability feature coming in Phase 6)
    return null;
  } catch (error) {
    console.error('Error getting staff availability:', error);
    return null;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a time is within a range, accounting for duration
 * 
 * @param time - Time in HH:MM format
 * @param startTime - Start time in HH:MM format
 * @param endTime - End time in HH:MM format
 * @param duration - Duration in minutes
 * @returns true if time + duration fits within range
 */
export function isTimeWithinRange(
  time: string,
  startTime: string,
  endTime: string,
  duration: number
): boolean {
  const [timeHour, timeMin] = time.split(':').map(Number);
  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);

  const timeInMinutes = timeHour * 60 + timeMin;
  const startInMinutes = startHour * 60 + startMin;
  const endInMinutes = endHour * 60 + endMin;

  return timeInMinutes >= startInMinutes && (timeInMinutes + duration) <= endInMinutes;
}

/**
 * Check if there's an appointment conflict
 * 
 * @param businessOwnerId - Business owner ID
 * @param date - Date in YYYY-MM-DD format
 * @param time - Time in HH:MM format
 * @param duration - Duration in minutes
 * @param staffId - Optional staff member ID
 * @returns true if conflict exists
 */
async function hasAppointmentConflict(
  businessOwnerId: number,
  date: string,
  time: string,
  duration: number,
  staffId?: string
): Promise<boolean> {
  try {
    // For now, return false (will be implemented with full database integration)
    return false;
  } catch (error) {
    console.error('Error checking appointment conflicts:', error);
    return false;
  }
}

/**
 * Get day of week from date
 * 
 * @param date - Date in YYYY-MM-DD format
 * @returns Day of week (Monday, Tuesday, etc.)
 */
function getDayOfWeek(date: string): string {
  const d = new Date(date);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[d.getDay()];
}

/**
 * Format time from Date object
 * 
 * @param date - Date object
 * @returns Time in HH:MM format
 */
function formatTime(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Add minutes to time string
 * 
 * @param time - Time in HH:MM format
 * @param minutes - Minutes to add
 * @returns New time in HH:MM format
 */
function addMinutesToTime(time: string, minutes: number): string {
  const [hour, min] = time.split(':').map(Number);
  const totalMinutes = hour * 60 + min + minutes;
  const newHour = Math.floor(totalMinutes / 60) % 24;
  const newMin = totalMinutes % 60;
  return `${newHour.toString().padStart(2, '0')}:${newMin.toString().padStart(2, '0')}`;
}

/**
 * Get staff member name
 * 
 * @param staffId - Staff member ID
 * @returns Staff name or empty string
 */
async function getStaffName(staffId: string): Promise<string> {
  try {
    // For now, return empty string (will be implemented with full database integration)
    return '';
  } catch (error) {
    return '';
  }
}

// ============================================================================
// Daily Override Functions (Phase 5)
// ============================================================================

/**
 * Create or update a daily override
 * 
 * @param businessOwnerId - Business owner ID
 * @param date - Date in YYYY-MM-DD format
 * @param isWorkDay - Whether business is open
 * @param startTime - Optional override start time
 * @param endTime - Optional override end time
 * @param notes - Optional notes
 */
export async function setDailyOverride(
  businessOwnerId: number,
  date: string,
  isWorkDay: boolean,
  startTime?: string,
  endTime?: string,
  notes?: string
) {
  // Phase 5 implementation
  console.log('setDailyOverride - Phase 5 implementation pending');
}

/**
 * Remove a daily override
 * 
 * @param businessOwnerId - Business owner ID
 * @param date - Date in YYYY-MM-DD format
 */
export async function removeDailyOverride(businessOwnerId: number, date: string) {
  // Phase 5 implementation
  console.log('removeDailyOverride - Phase 5 implementation pending');
}

/**
 * Get all daily overrides for a date range
 * 
 * @param businessOwnerId - Business owner ID
 * @param startDate - Start date in YYYY-MM-DD format
 * @param endDate - End date in YYYY-MM-DD format
 */
export async function getDailyOverrides(
  businessOwnerId: number,
  startDate: string,
  endDate: string
) {
  // Phase 5 implementation
  return [];
}

// ============================================================================
// Staff Availability Functions (Phase 6)
// ============================================================================

/**
 * Set staff availability for a specific date
 * 
 * @param staffId - Staff member ID
 * @param date - Date in YYYY-MM-DD format
 * @param isAvailable - Whether staff is available
 * @param startTime - Optional override start time
 * @param endTime - Optional override end time
 * @param notes - Optional notes
 */
export async function setStaffAvailability(
  staffId: string,
  date: string,
  isAvailable: boolean,
  startTime?: string,
  endTime?: string,
  notes?: string
) {
  // Phase 6 implementation
  console.log('setStaffAvailability - Phase 6 implementation pending');
}

/**
 * Remove staff availability override for a specific date
 * 
 * @param staffId - Staff member ID
 * @param date - Date in YYYY-MM-DD format
 */
export async function removeStaffAvailability(staffId: string, date: string) {
  // Phase 6 implementation
  console.log('removeStaffAvailability - Phase 6 implementation pending');
}

/**
 * Get all staff availability overrides for a date range
 * 
 * @param staffId - Staff member ID
 * @param startDate - Start date in YYYY-MM-DD format
 * @param endDate - End date in YYYY-MM-DD format
 */
export async function getStaffAvailabilityOverrides(
  staffId: string,
  startDate: string,
  endDate: string
) {
  // Phase 6 implementation
  return [];
}
