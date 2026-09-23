# NIS Parent-Teacher Conferences

Admin core for Nakornpayap International School parent-teacher conferences. IT sets up a conference, assigns teachers to services, and opens booking when the schedule is ready. Parents do not see a conference until it is open.

This slice is Phase 1 only: events, services, staff, and availability. The parent booking flow, teacher self-service calendar, and landing-page editor are not in this server.

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

PowerSchool teacher sync uses the built-in stand-in list until `PSAPI_BASE_URL`, `PSAPI_CLIENT_ID`, and `PSAPI_CLIENT_SECRET` are set. See `.env.example`.

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

`room_override` is stored on a staff assignment and is left null. The spec’s assign body is `{ staff_id }` only, so this phase does not edit it.

## Not in this phase

- Parent booking, reschedule, cancel, and the parent-view screen
- Email verification and trusted devices
- Teacher FullCalendar self-service (the availability API already limits teachers to their own rows)
- Booking reports
- Custom fields
- Landing-page sections
- The post-cutoff summary email
