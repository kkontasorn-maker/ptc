# NIS Parent-Teacher Conferences

Admin core for Nakornpayap International School parent-teacher conferences. IT sets up a conference, assigns teachers to services, and opens booking when the schedule is ready. Parents do not see a conference until it is open.

This server has the admin core (events, services, staff, availability) and the parent identity layer: email codes, a trusted-device cookie, child lookup, and the event parent view. The booking form, teacher self-service calendar, and landing-page editor are not in this server.

## Run

```bash
npm install
npm start
```

The server listens on port **47231** (override with `PORT`).

[Conferences](http://127.0.0.1:47231)

Sign in with an email from `config/roles.json`. The server assigns the role. The client cannot choose one.

| Email | Role |
|---|---|
| `it.admin@nis.ac.th` | IT admin |
| `front.office@nis.ac.th` | Front office (read-only) |
| `teacher@nis.ac.th` | Teacher, PowerSchool id `T1001` |

Google Workspace sign-in is used when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. Until then, the email form above is the local fallback and does not check a password. Set `ALLOW_LOCAL_AUTH=false` once Google is configured.

PowerSchool teacher sync and guardian lookup use the built-in stand-in lists until `PSAPI_BASE_URL`, `PSAPI_CLIENT_ID`, and `PSAPI_CLIENT_SECRET` are set. The stand-in guardian is `parent@nis.ac.th` (Niran Srisuk, grade 5, and Malee Srisuk, grade 2). See `.env.example`.

## Verify an email

Open [Verify your email](http://127.0.0.1:47231/#/verify). This page does not require a staff sign-in and does not require a conference to be open.

Until `SMTP_HOST` is set, and `NODE_ENV` is not `production`, the send-code response includes `dev_code` and the page shows it. The code is also written to the server log. With SMTP configured, the code is emailed and is not returned to the browser.

```bash
curl -s -D - -X POST http://127.0.0.1:47231/api/v1/auth/verification-codes \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: XMLHttpRequest' \
  -d '{"email":"parent@nis.ac.th"}'
```

Confirm with `POST /api/v1/auth/verification-codes/confirm` and `{ "email", "code" }`. The response sets `nis_ptc_device` (`HttpOnly`, `Secure`, 180 days). Then:

- `GET /api/v1/auth/device-status?email=parent@nis.ac.th`
- `GET /api/v1/parents/me/children?email=parent@nis.ac.th`
- `GET /api/v1/events/{id}/parent-view?email=parent@nis.ac.th` once that conference is open for booking

Send is limited to 3 codes per email per hour. A verified address with no PowerSchool guardian match returns `404` `NO_STUDENT_MATCH`. An unpublished conference returns `404` `Event not found` from parent-view, the same body as a missing id.

```bash
npm test
```

## Data

SQLite is created at `data/ptc.sqlite` on first start. `db/schema.sql` runs only when the `events` table is missing. There is no JSON store to import.

School dates and cutoff times are interpreted in `Asia/Bangkok` unless `APP_TIMEZONE` is set.

Event `status` is computed, not stored:

- **past** — the conference date is before today
- **draft** — the date has not passed and booking is not open
- **upcoming** — the date has not passed and booking is open

The spec does not say whether “open for booking” decides draft versus upcoming. That reading is what the Draft / Upcoming / Past labels need until it is confirmed. Cutoff does not flip an event to past; it locks availability changes and returns `423` with a message such as `Changes closed 14 Oct 2026 at 17:00`.

A parent session receives `404 Event not found` for an unpublished conference, the same response as a missing id.

`display_name` and `photo_url` are local overrides. Sync does not overwrite them, or `active`. Email is refreshed from PowerSchool.

Guardian lookups are cached for 5 minutes per email. Slot availability is computed on each parent-view request. `room_override` on a staff assignment replaces the PowerSchool room when it is set. There is still no admin API to edit `room_override`; the assign body remains `{ staff_id }`.

Break blocks are not subtracted from bookable windows. The spec does not define that overlap. A slot is unavailable only when a confirmed booking overlaps it. A remainder shorter than one slot is dropped.

## Not in this slice

- Booking create, reschedule, cancel, and the booking screen
- `GET /events/:eventId/services/:serviceId/staff/:staffId/slots` as its own route
- Booking lookup and reports
- Teacher FullCalendar self-service (the availability API already limits teachers to their own rows)
- Custom fields
- Landing-page sections
- The post-cutoff summary email
