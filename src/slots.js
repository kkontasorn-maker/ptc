import { formatInZone } from './time.js';

/**
 * Chunk each bookable window into slot_duration_minutes steps.
 * A remainder shorter than one slot is dropped.
 * Break blocks are ignored. The spec does not say to subtract a break that
 * overlaps a bookable window, so those minutes stay on the grid and are
 * marked unavailable only when a confirmed booking overlaps them.
 */
export function chunkSlots(blocks, durationMinutes, bookings, timeZone) {
  const durationMs = durationMinutes * 60 * 1000;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [];
  const slots = [];
  for (const block of blocks) {
    if (block.block_type && block.block_type !== 'bookable') continue;
    const startMs = Date.parse(block.start_time);
    const endMs = Date.parse(block.end_time);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    for (let cursor = startMs; cursor + durationMs <= endMs; cursor += durationMs) {
      const slotEnd = cursor + durationMs;
      const taken = bookings.some((booking) => {
        const bookingStart = Date.parse(booking.start_time);
        const bookingEnd = Date.parse(booking.end_time);
        if (!Number.isFinite(bookingStart) || !Number.isFinite(bookingEnd)) return false;
        return bookingStart < slotEnd && bookingEnd > cursor;
      });
      slots.push({
        start_time: formatInZone(new Date(cursor), timeZone),
        end_time: formatInZone(new Date(slotEnd), timeZone),
        available: !taken,
      });
    }
  }
  return slots;
}

export function isScheduledSlot(blocks, durationMinutes, startTime, endTime, timeZone) {
  const slots = chunkSlots(blocks, durationMinutes, [], timeZone);
  return slots.some((slot) => slot.start_time === startTime && slot.end_time === endTime);
}
