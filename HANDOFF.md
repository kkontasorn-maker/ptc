# NIS Parent–Teacher Conferences UX/UI handoff

## What is in this repository

This is a set of **interactive, static UX prototypes**, not a connected booking application. Open the HTML files in a browser. The pages share `nis-ptc-baseline.css` and the supplied NIS logo in `assets/`.

| File | Purpose |
| --- | --- |
| `index.html` | Public landing page routing parents and teachers/staff |
| `nis-ptc-admin.html` | IT Admin Events list and Create/Edit Event flow |
| `nis-ptc-events.css` | Events-page attention hierarchy and status styling |
| `nis-ptc-schedule.html` | Read-only all-teacher schedule overview with service filters |
| `nis-ptc-teacher.html` | Teacher's single-day FullCalendar agenda, booking moves, breaks, cutoff preview |
| `nis-ptc-parent.html` | Mobile-first parent booking, confirmation, and manage-booking flows |
| `nis-ptc-brand-system.html` | NIS palette, typography, spacing, contrast notes, and confirmation-screen sample |
| `nis-ptc-baseline.css` | Shared calm visual baseline across the three role prototypes |
| `assets/nis-primary-horizontal.png` | Supplied NIS primary full-color logo used in the UI |
| `assets/nis-secondary-horizontal.png` | Supplied NIS secondary horizontal logo for future layouts |

## Design baseline

- Use a light neutral page background, white cards, 0.5px neutral borders, dark neutral text, and restrained dark red (`#8C0E06`) for primary actions and small brand accents.
- The parent confirmation is the reference: small full-color logo, 40px soft green success badge, dark heading, regular-weight data values, one dark red primary button, neutral secondary button.
- The Events page deliberately highlights the active Events nav item and the upcoming event. Its **Create event** button remains dark red by request. Past and draft rows use neutral pills and outline actions.
- Teacher bookings are white blocks with solid gray outlines; blocked time has a light gray fill and dashed outline. The cutoff state uses a lock icon, explanatory text, and disabled interactions.
- NIS supplied palette: dark red `#8C0E06`, bright red `#E62125`, light gray `#BCBCBC`, blue `#225085`, dark gray `#64676A`, white `#FFFFFF`. Confirmation success additionally uses soft green `#E7F3EA` and check green `#1F6B3A`; its heading uses `#252525`.
- Typography uses Arial/system sans. The spacing scale is 4, 8, 12, 16, 24, and 32px. Interactive controls aim for at least 44px height.

## Prototype behavior

### Landing page

`index.html` is the frontend entry point. It presents two equal role tiles: Parents routes to the booking flow and Teachers & Staff routes to the teacher agenda. A small text link beneath the tiles opens the admin prototype. The parents icon uses the dark-red brand accent; the staff icon remains neutral gray.

### Admin

The Events list includes status filtering and seeded past/upcoming conferences. Create/Edit captures the event name, conference date, change cutoff date and time in Chiang Mai time (ICT), and whether the event is open for parent booking. The two save paths create either a private draft or an event using the selected booking visibility. Events persist in browser `localStorage` under `nis-ptc-events-v1`. Managing an event opens its Services list with service name, slot duration, assigned teacher count, neutral Manage controls, a primary Add service action, and a route back to event details. The individual service editor and Booking fields editor remain future steps.

The Bookings navigation item opens a read-only table for the selected sample event with Student, Teacher, Time, and Status columns. Confirmed bookings use a neutral pill; cancelled bookings use a light red pill and strike through the student name. Export CSV downloads the displayed rows as `nis-ptc-bookings-2026-10-16.csv`.

The Teachers navigation item opens a sample detail page for Ms. Maya Chen with identity details and Availability, Services, and Block Time tabs. Availability is the default and shows the assigned service, 10-minute slot duration, availability window pills, an Add window interaction, and a primary Save availability action. The other tabs provide lightweight contextual placeholders for the prototype.

### Teacher

The teacher page shows a fixed sample event on **16 October 2026**, from **08:00–15:30 ICT**, with a **14 October 2026 at 17:00 ICT** cutoff. It is a single-column vertical agenda with one row per 10-minute slot. Bookings use a dark-red left accent and drag handle; breaks use a hatched background and dashed border; open rows use a dashed outline. Dragging a booking onto an open row opens a confirmation step before saving. On narrow screens, tapping a booking opens a time picker and then the same confirmation step. The secondary “Block time” button adds a checked break range. Conflicting or out-of-window times are rejected. The “Preview cutoff passed” checkbox shows the read-only state. Changes persist in `localStorage` under `nis-ptc-teacher-list-v1`.

### Schedule overview

The admin schedule overview is a read-only teacher-column/time-row grid. Elementary shows five teachers at 15-minute intervals; Middle & High School shows four teachers at 10-minute intervals. The chip filter switches the dataset and time scale. Booked cells use a contained light-gray card, breaks add a diagonal hatch and dashed outline, and open slots remain empty. The screen is intentionally grayscale with no red attention treatment.

### Parent

The parent flow covers grade/section, teacher/time, a streamlined booking form, email verification, confirmation, and email-based manage-booking. Teacher selection shows every slot across the assigned conference windows; occupied times remain visible with a muted, struck, disabled style and a two-state legend. Immediately after slot selection, the form collects Student name, Nickname, Grade level, Relationship to student (including free-text Other), and Email, followed by one full-width Continue button. Continue opens a six-digit code screen with auto advance, paste support, keyboard navigation, validation, and a resend action. The local prototype accepts any complete six-digit code and simulates resend; production needs real code issuance, delivery, expiry, and server-side validation. The confirmation email is a **preview only**; no email is sent. After email lookup, “Your bookings” lists every confirmed conference with teacher, service, student, and date/time. Each card offers neutral Reschedule and Cancel actions before the cutoff; after the cutoff those controls are replaced by a lock icon and deadline notice. Bookings persist in `localStorage` under `nis-ptc-parent-bookings-v1`.

## Important implementation gaps

1. Connect authentication for staff and parents; the current Google/Facebook choices are visual simulations.
2. Verify email ownership before revealing bookings in the real manage-booking flow. Entering an address alone is only appropriate for this local prototype.
3. Add a backend with transactional booking/slot locking, event/service/staff data, PowerSchool sync, role permissions, and authoritative cutoff enforcement. Browser `localStorage` is sample state only.
4. Send real confirmation, reschedule, and cancellation emails with a trusted delivery service.
5. Build the remaining admin editors for Services, bulk teacher assignment, teacher time blocks, and custom booking fields.
6. Source teacher availability, booking durations, event dates, and cutoff settings from the backend rather than the fixed sample event.

## Review notes

The HTML files can be opened directly. To serve them locally, run `python3 -m http.server 8000` in this directory and open `http://localhost:8000/nis-ptc-admin.html`. The prototypes were visually checked in a browser at desktop size, and a sample parent booking was completed through confirmation and then removed. JavaScript syntax was checked for each page. A production implementation still needs responsive and accessibility testing with real data and assistive technology.
