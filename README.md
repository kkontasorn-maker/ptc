# NIS Parent-Teacher Conferences

Admin core for Nakornpayap International School parent-teacher conferences. IT sets up a conference, assigns teachers to services, and opens booking when the schedule is ready. Parents do not see a conference until it is open.

This server has the admin core, parent email verification, booking submission, and the teacher agenda. The landing-page editor is not in this server.

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

PowerSchool teacher sync and guardian lookup use the built-in stand-in lists until `PSAPI_BASE_URL`, `PSAPI_CLIENT_ID`, and `PSAPI_CLIENT_SECRET` are set. The stand-in guardians are `parent@nis.ac.th` and `father@example.com` (both match Niran Srisuk, grade 5, and Malee Srisuk, grade 2). With PowerSchool configured, a guardian match walks email addresses to people, then to active student contacts, and loads those students by dcid. See `.env.example`.

Sign in as `it.admin@nis.ac.th` and open Conferences. The PowerSchool card shows whether the last live call succeeded, and **Test connection** runs one small students query. The page load does not call PowerSchool. Credentials stay in the server environment; the card and the status routes never accept or return them.

## Verify an email

Open [Verify your email](http://127.0.0.1:47231/#/verify). This page does not require a staff sign-in and does not require a conference to be open.

Until `SMTP_HOST` is set, and `NODE_ENV` is not `production`, the send-code response includes `dev_code` and the page shows it. The code is also written to the server log. With SMTP configured, the code is emailed and is not returned to the browser.

`EMAIL_ALLOWLIST` is a separate gate from `NODE_ENV` and `ALLOW_LOCAL_AUTH`. Copy it from `.env.example` and export it before `npm start` (this server does not load `.env` by itself). While it is set, verification codes and summary mail for anyone not on the list are redirected to the first address, with the real recipient and original subject prepended. Unset it only for a real pilot or production deploy.

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

## Book a conference

Open [Book a conference](http://127.0.0.1:47231/#/book/1) after the email is verified. Replace `1` with the open conference id. The screen loads `GET /events/{id}/parent-view`, then submits every selected time in one `POST /api/v1/bookings`.

```bash
curl -s -b cookies.txt -X POST http://127.0.0.1:47231/api/v1/bookings \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: XMLHttpRequest' \
  -d '{
    "parent_email": "parent@nis.ac.th",
    "parent_relationship": "mother",
    "picks": [{
      "student_powerschool_id": "S1001",
      "service_id": 1,
      "staff_id": 1,
      "start_time": "2026-10-23T08:00:00+07:00",
      "end_time": "2026-10-23T08:15:00+07:00"
    }]
  }'
```

The server checks the device cookie, the guardian match, the teacher assignment, and the open slot again. If any pick fails, none are saved. A taken slot returns `409`. After `cutoff_at`, create, reschedule, and cancel return `423` with a message such as `Changes closed 14 Oct 2026 at 17:00`.

- `PATCH /api/v1/bookings/{id}/reschedule` with `{ "start_time", "end_time" }`
- `DELETE /api/v1/bookings/{id}` cancels one time
- `DELETE /api/v1/bookings/batch/{booking_batch_id}` cancels the whole visit

`parent_first_name` and `parent_last_name` are optional. The spec does not say they are required.

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

## Teacher agenda

Sign in as `teacher@nis.ac.th`. The form does not ask for a password. The app opens [Agenda](http://127.0.0.1:47231/#/agenda).

Choose a conference day. The calendar is that day only. Drag a confirmed meeting onto another open slot. The move uses the same reschedule check as a parent change: the time has to be a real slot, and after `cutoff_at` the server returns `423` with the lock message. Select a range on the day and press **Block time** to add a break. Breaks are a hatch with a dashed border. The lock row is muted text and a lock icon.

`GET /events/:eventId/my-schedule` is teacher-only. The staff row is the session's PowerSchool teacher id. A `staff_id` on the request is ignored. Availability reads and writes still use §4.4 and refuse another teacher's id.

A break that overlaps confirmed bookings, or unassigning a teacher who still has confirmed bookings, returns `409` with those bookings. Sending `{ confirm_override: true, reason }` goes ahead, flags the bookings for front office, and emails each parent once through the shared mail gate. The email does not include the reason. `notified_at` is set only when SMTP accepts the message.

## Booking report

Sign in as `front.office@nis.ac.th` and open a conference, then **Bookings**. The same screen is there for `it.admin@nis.ac.th`. It lists every booking for that conference. Front office cannot change events, services, staff, availability, or bookings; those routes return `403`.

## Summary email

When `cutoff_at` is in the past and `summary_sent_at` is empty, the server emails each parent who still has a confirmed booking. One message lists that parent's meetings: teacher, time, and room (`room_override`, otherwise the PowerSchool room, otherwise `NIS Elementary Building`). Cancelled rows are left out. `summary_sent_at` is set when the batch is claimed, so a later check does not send again. If sending fails before any message goes out, the claim is cleared and the next check tries again.

`node server.js` runs that check at startup and then every 60 seconds. Set `SUMMARY_INTERVAL_MS=0` to run only at startup. Without `SMTP_HOST`, the message is written to the server log instead of emailed, and the event is still marked sent. The same `EMAIL_ALLOWLIST` gate applies before that log or SMTP send.

## Notification issues

Every completed send through the shared mail function writes an `email_deliveries` row with status `sent`. The recipient stored is the parent address, including when `EMAIL_ALLOWLIST` redirects the SMTP envelope. If the mail client returns a message id, it is stored. Plain SMTP that does not return one leaves `provider_message_id` empty, and that row stays `sent` until it ages into the unconfirmed list.

Sign in as `it.admin@nis.ac.th` or `front.office@nis.ac.th` and open [Notification issues](http://127.0.0.1:47231/#/notifications). The list shows bounced and complained mail, plus anything still `sent` with no status update after `DELIVERY_ISSUE_STALE_HOURS` (default 24). Front office can read the list and cannot change it. There is no resend button.

After a parent verifies their email, the verify page asks for an optional LINE ID, phone number, or WeChat ID. Skip does not save anything. Saving calls `PATCH /api/v1/parents/me/contact-preference`. Verification and booking do not wait for that step.

Webhook delivery updates are `POST /api/v1/webhooks/email-status`. The route does not use a staff session. It checks `EMAIL_WEBHOOK_PROVIDER` and `EMAIL_WEBHOOK_SECRET`. Until both are set, the route returns 401. Adapters are `hmac`, `postmark`, `mailgun`, `sendgrid`, and `ses`. See `.env.example` for the header and body each one expects. A signed event with an unknown message id still returns 200.

## Not in this slice

- `GET /events/:eventId/services/:serviceId/staff/:staffId/slots` as its own route
- `GET /bookings/lookup`
- Custom fields
- Landing-page sections
