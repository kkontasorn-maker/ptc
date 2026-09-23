import { locationLabel, resolveBookingRooms } from './booking-rooms.js';
import { deliverSummary } from './mail/mailer.js';
import { isPastCutoff } from './time.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatWhen(start, end) {
  const [year, month, day] = start.slice(0, 10).split('-').map(Number);
  const date = year && month && day ? `${day} ${MONTHS[month - 1]} ${year}` : start.slice(0, 10);
  return `${date}, ${start.slice(11, 16)}–${end.slice(11, 16)}`;
}

function groupConfirmed(rows, rooms) {
  const groups = new Map();
  rows.forEach((row, index) => {
    if (row.status !== 'confirmed') return;
    const booking = {
      student_name: row.student_name,
      student_nickname: row.student_nickname,
      student_grade: row.student_grade,
      display_name: row.display_name,
      service_name: row.service_name,
      when: formatWhen(row.start_time, row.end_time),
      location: locationLabel(rooms[index]),
      start_time: row.start_time,
    };
    const list = groups.get(row.parent_email) || [];
    list.push(booking);
    groups.set(row.parent_email, list);
  });
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([email, bookings]) => [email, bookings.sort((a, b) => a.start_time.localeCompare(b.start_time))]);
}

let tail = Promise.resolve();

export function runCutoffSummaries(options) {
  const run = tail.then(() => sendDueSummaries(options));
  tail = run.catch((error) => {
    console.error(error);
  });
  return run;
}

async function sendDueSummaries({ repos, mail, psapi, now = new Date(), deliver = deliverSummary }) {
  const due = repos.events.list().filter((event) => (
    !event.summary_sent_at && isPastCutoff(event.cutoff_at, now)
  ));
  const results = [];
  for (const event of due) {
    if (!repos.events.claimSummary(event.id)) continue;
    const rows = repos.bookings.listForReport(event.id);
    const rooms = await resolveBookingRooms(psapi, rows);
    const groups = groupConfirmed(rows, rooms);
    let sent = 0;
    try {
      for (const [email, bookings] of groups) {
        await deliver({
          mail,
          email,
          eventName: event.name,
          bookings,
          relatedId: event.id,
        });
        sent += 1;
      }
      results.push({ event_id: event.id, parents: sent });
    } catch (error) {
      console.error(error);
      if (sent === 0) repos.events.clearSummary(event.id);
      results.push({ event_id: event.id, parents: sent, failed: true });
    }
  }
  return results;
}

export function startSummaryJob({ intervalMs = 60_000, ...options }) {
  const run = () => {
    runCutoffSummaries(options).catch((error) => console.error(error));
  };
  run();
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return () => {};
  const timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
