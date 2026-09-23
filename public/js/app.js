const html = htm.bind(React.createElement);
const { useCallback, useEffect, useMemo, useState } = React;

const ROLE_LABEL = {
  it_admin: 'IT admin',
  front_office: 'Front office',
  teacher: 'Teacher',
  parent: 'Parent',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    const error = new Error('Could not reach the server');
    error.status = 0;
    error.details = [];
    throw error;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || 'Request failed');
    error.status = response.status;
    error.code = data?.error?.code;
    error.details = data?.error?.details || [];
    error.payload = data;
    if (response.status === 401 && !options.allow401) {
      window.dispatchEvent(new Event('ptc-unauthorized'));
    }
    throw error;
  }
  return data;
}

function fieldMap(error) {
  const fields = {};
  for (const detail of error?.details || []) {
    if (detail.field) fields[detail.field] = detail.message;
  }
  return fields;
}

function formatDate(iso) {
  if (!iso) return 'Not set';
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return iso;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

function formatWhen(iso) {
  if (!iso) return 'Not set';
  return `${formatDate(iso)} at ${iso.slice(11, 16)}`;
}

function cutoffMessage(cutoff, timeZone) {
  const date = new Date(cutoff);
  if (Number.isNaN(date.getTime())) return 'Changes are closed';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone || 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  const hour = get('hour') === '24' ? '00' : get('hour').padStart(2, '0');
  return `Changes closed ${get('day')} ${get('month')} ${get('year')} at ${hour}:${get('minute').padStart(2, '0')}`;
}

function cutoffPassed(cutoff) {
  if (!cutoff) return false;
  const time = Date.parse(cutoff);
  return !Number.isNaN(time) && Date.now() > time;
}

function initials(name) {
  const bits = String(name || '').trim().split(/\s+/).slice(0, 2);
  return bits.map((bit) => bit[0]).join('').toUpperCase() || '?';
}

function positiveId(value) {
  return /^[1-9]\d*$/.test(value || '') ? Number(value) : null;
}

function parseRoute(hash) {
  const raw = (hash || '').replace(/^#/, '');
  const [pathPart, queryPart] = raw.split('?');
  const query = new URLSearchParams(queryPart || '');
  const parts = (pathPart || '/events').split('/').filter(Boolean);
  const error = query.get('error');
  if (parts[0] === 'sign-in') return { name: 'sign-in', error };
  if (parts[0] === 'staff') {
    return parts[1] ? { name: 'staff-edit', id: parts[1] } : { name: 'staff' };
  }
  if (parts[0] === 'events') {
    if (!parts[1]) return { name: 'events' };
    if (parts[1] === 'new') return { name: 'event-new' };
    if (parts[2] === 'services') return { name: 'services', id: parts[1] };
    if (parts[2] === 'availability') return { name: 'availability', id: parts[1] };
    if (!parts[2]) return { name: 'event', id: parts[1] };
  }
  return { name: 'events' };
}

function useRoute() {
  const [hash, setHash] = useState(() => window.location.hash || '#/events');
  useEffect(() => {
    if (!window.location.hash) window.location.hash = '#/events';
    const onChange = () => setHash(window.location.hash || '#/events');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return parseRoute(hash);
}

function Logo() {
  return html`<a className="logo" href="#/events">
    <svg className="logo-mark" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#8C0E06" fillRule="evenodd" d="M24 4 44 44h-8l-3-8H15l-3 8H4L24 4Zm0 16-4.6 12h9.2L24 20Z" />
    </svg>
    <span className="wordmark">
      <span className="wordmark-line">NAKORNPAYAP</span>
      <span className="wordmark-sub">INTERNATIONAL SCHOOL</span>
    </span>
  </a>`;
}

function IconCalendar() {
  return html`<svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M3.5 10h17M8 3.5V6M16 3.5V6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>`;
}

function IconPeople() {
  return html`<svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="9" cy="8" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M4.5 18.5c.6-2.6 2.4-4 4.5-4s3.9 1.4 4.5 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="16.5" cy="8.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M16 14.6c1.6.2 2.9 1.2 3.5 3.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>`;
}

function IconLock() {
  return html`<svg className="lock-icon" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M8 10V8a4 4 0 0 1 8 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>`;
}

function StatusPill({ status, attention }) {
  const label = status === 'draft' ? 'Draft' : status === 'upcoming' ? 'Upcoming' : status === 'past' ? 'Past' : status;
  return html`<span className=${cx('pill', attention && status === 'upcoming' && 'attention')}>${label}</span>`;
}

function LockRow({ cutoff, timeZone }) {
  if (!cutoffPassed(cutoff)) return null;
  return html`<div className="lock-row">${html`<${IconLock} />`}<span>${cutoffMessage(cutoff, timeZone)}</span></div>`;
}

function Shell({ user, active, onSignOut, children }) {
  return html`<div>
    <header className="app-header">
      <${Logo} />
      <nav className="nav" aria-label="Sections">
        <a href="#/events" className=${active === 'events' ? 'active' : ''} aria-current=${active === 'events' ? 'page' : undefined}>
          <${IconCalendar} /> Conferences
        </a>
        <a href="#/staff" className=${active === 'staff' ? 'active' : ''} aria-current=${active === 'staff' ? 'page' : undefined}>
          <${IconPeople} /> Staff
        </a>
      </nav>
      <div className="header-user">
        <div className="who">
          <div className="who-email">${user.email}</div>
          <div className="who-role">${ROLE_LABEL[user.role] || user.role}</div>
        </div>
        <button type="button" className="btn btn-secondary" onClick=${onSignOut}>Sign out</button>
      </div>
    </header>
    <main className="main">${children}</main>
  </div>`;
}

function AccessNote({ user }) {
  if (user.role === 'it_admin') return null;
  const text = user.role === 'front_office'
    ? 'Front office can review conferences. Changes are limited to IT admin.'
    : user.role === 'teacher'
      ? 'Teacher self-service is a later step. This screen is read-only.'
      : 'This area is for staff.';
  return html`<p className="muted">${text}</p>`;
}

function signInMessage(code) {
  if (code === 'unassigned') return 'This Google account is not assigned a role. Ask ICT to add the email.';
  if (code === 'google') return 'Google sign-in did not complete. Try again.';
  return '';
}

function SignIn({ auth, notice, onSignedIn }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState(notice || '');
  const [busy, setBusy] = useState(false);
  const googlePrimary = Boolean(auth.google);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api('/auth/session', { method: 'POST', body: { email } });
      onSignedIn(data);
      window.location.hash = '#/events';
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return html`<div>
    <header className="app-header"><${Logo} /></header>
    <main className="main">
      <div className="signin">
        <div className="screen-head">
          <div>
            <h1>Sign in</h1>
            <p className="lede">ICT and front office use the NIS account assigned to conferences.</p>
          </div>
        </div>
        <div className="stack">
          ${error ? html`<div className="note">${error}</div>` : null}
          ${auth.google ? html`<a className="btn btn-primary" href="/api/v1/auth/google">Sign in with Google</a>` : null}
          ${auth.local ? html`<form className="card form" onSubmit=${submit}>
            ${!auth.google ? html`<p className="muted">Google sign-in is not configured on this server. Enter the email ICT assigned. The server chooses the role.</p>` : html`<p className="muted">Or sign in with an assigned email on this server.</p>`}
            <label className="field">
              <span className="field-label">Email</span>
              <input className="input" type="email" name="email" autoComplete="username" required value=${email} placeholder="name@nis.ac.th" onInput=${(event) => setEmail(event.target.value)} />
              ${!auth.google ? html`<span className="field-hint">Sample IT admin: it.admin@nis.ac.th</span>` : null}
            </label>
            <button className=${googlePrimary ? 'btn btn-secondary' : 'btn btn-primary'} type="submit" disabled=${busy}>${busy ? 'Signing in…' : 'Sign in'}</button>
          </form>` : null}
          ${!auth.google && !auth.local ? html`<div className="note">Sign-in is not configured. Set Google credentials or enable local sign-in.</div>` : null}
        </div>
      </div>
    </main>
  </div>`;
}

function attentionEventId(events) {
  const upcoming = events
    .filter((event) => event.status === 'upcoming')
    .sort((a, b) => a.event_date.localeCompare(b.event_date) || a.id - b.id);
  return upcoming[0]?.id ?? null;
}

function eventStateLine(event) {
  if (event.status === 'past') return 'Conference date has passed';
  if (event.is_open_for_booking) return 'Open for booking';
  return 'Hidden from parents';
}

function EventsScreen({ user }) {
  const canWrite = user.role === 'it_admin';
  const [state, setState] = useState({ loading: true, error: null, events: [] });

  const load = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }));
    api('/events')
      .then((data) => setState({ loading: false, error: null, events: data.events || [] }))
      .catch((error) => setState({ loading: false, error, events: [] }));
  }, []);

  useEffect(() => { load(); }, [load]);

  const focusId = attentionEventId(state.events);
  const ordered = useMemo(() => {
    const events = [...state.events];
    events.sort((a, b) => {
      const aPast = a.status === 'past';
      const bPast = b.status === 'past';
      if (aPast !== bPast) return aPast ? 1 : -1;
      if (aPast) return b.event_date.localeCompare(a.event_date);
      return a.event_date.localeCompare(b.event_date) || a.id - b.id;
    });
    return events;
  }, [state.events]);

  return html`<${Shell} user=${user} active="events">
    <div className="screen-head">
      <div>
        <h1>Conferences</h1>
        <p className="lede">Set up services and availability, then open a conference for parents.</p>
      </div>
      ${canWrite && !state.error ? html`<a className="btn btn-primary" href="#/events/new">Create conference</a>` : null}
      ${state.error ? html`<button type="button" className="btn btn-primary" onClick=${load}>Try again</button>` : null}
    </div>
    <div className="stack">
      <${AccessNote} user=${user} />
      ${state.loading ? html`<p className="muted">Loading conferences…</p>` : null}
      ${state.error ? html`<div className="note">${state.error.message}</div>` : null}
      ${!state.loading && !state.error && ordered.length === 0 ? html`<div className="card">
        <p>No conferences yet.</p>
        <p className="lede">Create one when the next parent-teacher day is on the calendar.</p>
      </div>` : null}
      ${!state.loading && !state.error ? html`<div className="list">
        ${ordered.map((event) => html`<a className="card event-card" href=${`#/events/${event.id}`} key=${event.id}>
          <span className="icon-badge" aria-hidden="true"><${IconCalendar} /></span>
          <span>
            <span className="event-title">${event.name}</span>
            <span className="event-meta">${formatDate(event.event_date)} · ${eventStateLine(event)}</span>
          </span>
          <${StatusPill} status=${event.status} attention=${event.id === focusId} />
        </a>`)}
      </div>` : null}
    </div>
  </${Shell}>`;
}

function NewEventScreen({ user }) {
  const canWrite = user.role === 'it_admin';
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [cutoff, setCutoff] = useState('');
  const [fields, setFields] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setFormError('');
    setFields({});
    try {
      const body = { name, event_date: date };
      if (cutoff) body.cutoff_at = cutoff;
      const data = await api('/events', { method: 'POST', body });
      window.location.hash = `#/events/${data.event.id}`;
    } catch (error) {
      setFields(fieldMap(error));
      setFormError(Object.keys(fieldMap(error)).length ? '' : error.message);
      setBusy(false);
    }
  }

  return html`<${Shell} user=${user} active="events">
    <a className="back" href="#/events">Conferences</a>
    <div className="screen-head section-gap">
      <div>
        <h1>New conference</h1>
        <p className="lede">It stays hidden from parents until you open it for booking.</p>
      </div>
    </div>
    ${canWrite ? html`<form className="card form" onSubmit=${submit}>
      ${formError ? html`<div className="note">${formError}</div>` : null}
      <label className="field">
        <span className="field-label">Name</span>
        <input className="input" name="name" required value=${name} onInput=${(event) => setName(event.target.value)} />
        ${fields.name ? html`<span className="field-error">${fields.name}</span>` : null}
      </label>
      <label className="field">
        <span className="field-label">Conference date</span>
        <input className="input" type="date" name="event_date" required value=${date} onInput=${(event) => setDate(event.target.value)} />
        ${fields.event_date ? html`<span className="field-error">${fields.event_date}</span>` : null}
      </label>
      <label className="field">
        <span className="field-label">Cutoff</span>
        <input className="input" type="datetime-local" name="cutoff_at" value=${cutoff} onInput=${(event) => setCutoff(event.target.value)} />
        <span className="field-hint">Optional. After this time, availability changes lock.</span>
        ${fields.cutoff_at ? html`<span className="field-error">${fields.cutoff_at}</span>` : null}
      </label>
      <div className="btn-row">
        <button className="btn btn-primary" type="submit" disabled=${busy}>${busy ? 'Creating…' : 'Create conference'}</button>
        <a className="btn btn-secondary" href="#/events">Cancel</a>
      </div>
    </form>` : html`<div className="note">You do not have access to this action.</div>`}
  </${Shell}>`;
}

function Subnav({ id, section }) {
  return html`<nav className="subnav" aria-label="Conference">
    <a href=${`#/events/${id}`} className=${section === 'details' ? 'active' : ''}>Details</a>
    <a href=${`#/events/${id}/services`} className=${section === 'services' ? 'active' : ''}>Services</a>
    <a href=${`#/events/${id}/availability`} className=${section === 'availability' ? 'active' : ''}>Availability</a>
  </nav>`;
}

function EventWorkspace({ user, eventId, section, timeZone }) {
  const id = positiveId(eventId);
  const [state, setState] = useState({ loading: true, error: null, event: null });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    if (!id) return undefined;
    let live = true;
    setState((current) => ({
      loading: true,
      error: null,
      event: current.event && current.event.id === id ? current.event : null,
    }));
    api(`/events/${id}`)
      .then((data) => { if (live) setState({ loading: false, error: null, event: data.event }); })
      .catch((error) => { if (live) setState({ loading: false, error, event: null }); });
    return () => { live = false; };
  }, [id, version]);

  if (!id) {
    return html`<${Shell} user=${user} active="events"><div className="note">That conference does not exist.</div></${Shell}>`;
  }

  return html`<${Shell} user=${user} active="events">
    <a className="back" href="#/events">Conferences</a>
    ${state.loading && !state.event ? html`<p className="muted section-gap">Loading conference…</p>` : null}
    ${state.error ? html`<div className="stack section-gap">
      <div className="note">${state.error.message}</div>
      <button type="button" className="btn btn-primary" onClick=${reload}>Try again</button>
    </div>` : null}
    ${state.event ? html`<div className="section-gap">
      <div className="title-row">
        <h1>${state.event.name}</h1>
        <${StatusPill} status=${state.event.status} attention=${true} />
      </div>
      <${Subnav} id=${state.event.id} section=${section} />
      <${AccessNote} user=${user} />
      ${section === 'details' ? html`<${DetailsPanel} event=${state.event} user=${user} timeZone=${timeZone} onSaved=${reload} />` : null}
      ${section === 'services' ? html`<${ServicesPanel} event=${state.event} user=${user} onChange=${reload} />` : null}
      ${section === 'availability' ? html`<${AvailabilityPanel} event=${state.event} user=${user} timeZone=${timeZone} />` : null}
    </div>` : null}
  </${Shell}>`;
}

function DetailsPanel({ event, user, timeZone, onSaved }) {
  const canWrite = user.role === 'it_admin';
  const [name, setName] = useState(event.name);
  const [date, setDate] = useState(event.event_date);
  const [cutoff, setCutoff] = useState(event.cutoff_at ? event.cutoff_at.slice(0, 16) : '');
  const [open, setOpen] = useState(event.is_open_for_booking);
  const [fields, setFields] = useState({});
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(event.name);
    setDate(event.event_date);
    setCutoff(event.cutoff_at ? event.cutoff_at.slice(0, 16) : '');
    setOpen(event.is_open_for_booking);
  }, [event.id, event.updated_at, event.is_open_for_booking, event.name, event.event_date, event.cutoff_at]);

  async function submit(formEvent) {
    formEvent.preventDefault();
    setBusy(true);
    setSuccess('');
    setFormError('');
    setFields({});
    try {
      await api(`/events/${event.id}`, {
        method: 'PATCH',
        body: {
          name,
          event_date: date,
          cutoff_at: cutoff || null,
          is_open_for_booking: open,
        },
      });
      setSuccess('Conference saved.');
      onSaved();
    } catch (error) {
      const mapped = fieldMap(error);
      setFields(mapped);
      setFormError(Object.keys(mapped).length ? '' : error.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setFormError('');
    try {
      await api(`/events/${event.id}`, { method: 'DELETE' });
      window.location.hash = '#/events';
    } catch (error) {
      setFormError(error.message);
      setBusy(false);
    }
  }

  if (!canWrite) {
    return html`<div className="card">
      <div className="data-row"><div className="data-label">Date</div><div className="data-value">${formatDate(event.event_date)}</div></div>
      <div className="data-row"><div className="data-label">Cutoff</div><div className="data-value">${event.cutoff_at ? formatWhen(event.cutoff_at) : 'Not set'}</div></div>
      <div className="data-row"><div className="data-label">Open for booking</div><div className="data-value">${event.is_open_for_booking ? 'Yes' : 'No'}</div></div>
      <div className="data-row"><div className="data-label">Services</div><div className="data-value">${event.staff_summary.service_count}</div></div>
      <div className="data-row"><div className="data-label">Assigned staff</div><div className="data-value">${event.staff_summary.assigned_staff_count}</div></div>
      <${LockRow} cutoff=${event.cutoff_at} timeZone=${timeZone} />
    </div>`;
  }

  return html`<form className="card form" onSubmit=${submit}>
    ${success ? html`<div><span className="success-note">${success}</span></div>` : null}
    ${formError ? html`<div className="note">${formError}</div>` : null}
    <label className="field">
      <span className="field-label">Name</span>
      <input className="input" name="name" required value=${name} onInput=${(event) => setName(event.target.value)} />
      ${fields.name ? html`<span className="field-error">${fields.name}</span>` : null}
    </label>
    <label className="field">
      <span className="field-label">Conference date</span>
      <input className="input" type="date" required value=${date} onInput=${(event) => setDate(event.target.value)} />
      ${fields.event_date ? html`<span className="field-error">${fields.event_date}</span>` : null}
    </label>
    <label className="field">
      <span className="field-label">Cutoff</span>
      <input className="input" type="datetime-local" value=${cutoff} onInput=${(event) => setCutoff(event.target.value)} />
      <span className="field-hint">Leave blank to clear the cutoff.</span>
      ${fields.cutoff_at ? html`<span className="field-error">${fields.cutoff_at}</span>` : null}
    </label>
    <div className="switch-row">
      <div>
        <div className="field-label">Open for booking</div>
        <div className="field-hint">Parents cannot see this conference until this is on. Save to apply.</div>
      </div>
      <button type="button" className=${cx('toggle', open && 'on')} role="switch" aria-checked=${open ? 'true' : 'false'} aria-label="Open for booking" onClick=${() => setOpen((value) => !value)}>
        <span className="toggle-knob"></span>
      </button>
    </div>
    <${LockRow} cutoff=${event.cutoff_at} timeZone=${timeZone} />
    <div className="data-row"><div className="data-label">Created by</div><div className="data-value">${event.created_by}</div></div>
    <div className="btn-row">
      <button className="btn btn-primary" type="submit" disabled=${busy}>${busy ? 'Saving…' : 'Save'}</button>
      <${DeleteControl} label="Delete this conference?" busy=${busy} onConfirm=${remove} />
    </div>
  </form>`;
}

function DeleteControl({ label, busy, onConfirm }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return html`<button type="button" className="btn btn-secondary" onClick=${() => setOpen(true)}>Delete</button>`;
  }
  return html`<div className="confirm">
    <p>${label}</p>
    <div className="row-actions section-gap">
      <button type="button" className="btn btn-secondary" onClick=${() => setOpen(false)}>Cancel</button>
      <button type="button" className="btn btn-secondary" disabled=${busy} onClick=${onConfirm}>Delete</button>
    </div>
  </div>`;
}

function ServicesPanel({ event, user, onChange }) {
  const canWrite = user.role === 'it_admin';
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState('');
  const [duration, setDuration] = useState('15');
  const [fields, setFields] = useState({});
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [directory, setDirectory] = useState(null);

  useEffect(() => {
    let live = true;
    api('/staff')
      .then((data) => { if (live) setDirectory(data.staff || []); })
      .catch(() => { if (live) setDirectory([]); });
    return () => { live = false; };
  }, [event.id]);

  function beginEdit(service) {
    setEditingId(service.id);
    setName(service.name);
    setDuration(String(service.slot_duration_minutes));
    setFields({});
    setFormError('');
    setSuccess('');
  }

  async function saveService(formEvent) {
    formEvent.preventDefault();
    setBusy(true);
    setFormError('');
    setFields({});
    const payload = { name, slot_duration_minutes: Number(duration) };
    try {
      if (editingId) {
        await api(`/services/${editingId}`, { method: 'PATCH', body: payload });
        setSuccess('Service saved.');
        setEditingId(null);
      } else {
        await api(`/events/${event.id}/services`, { method: 'POST', body: payload });
        setSuccess('Service added.');
        setName('');
        setDuration('15');
      }
      onChange();
    } catch (error) {
      const mapped = fieldMap(error);
      setFields(mapped);
      setFormError(Object.keys(mapped).length ? '' : error.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeService(serviceId) {
    setBusy(true);
    setFormError('');
    try {
      await api(`/services/${serviceId}`, { method: 'DELETE' });
      setSuccess('Service deleted.');
      onChange();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function assign(serviceId, staffId) {
    setFormError('');
    try {
      await api(`/services/${serviceId}/staff`, { method: 'POST', body: { staff_id: Number(staffId) } });
      setSuccess('Staff assigned.');
      onChange();
    } catch (error) {
      setSuccess('');
      setFormError(error.message);
    }
  }

  async function unassign(serviceId, staffId) {
    setFormError('');
    try {
      await api(`/services/${serviceId}/staff/${staffId}`, { method: 'DELETE' });
      setSuccess('Staff removed.');
      onChange();
    } catch (error) {
      setSuccess('');
      setFormError(error.message);
    }
  }

  const staffDirectory = directory || [];
  const synced = staffDirectory.filter((member) => member.id && member.active);

  return html`<div className="stack">
    ${success ? html`<div><span className="success-note">${success}</span></div>` : null}
    ${formError ? html`<div className="note">${formError}</div>` : null}
    ${canWrite && !editingId ? html`<form className="card form" onSubmit=${saveService}>
      <h2>Add a service</h2>
      <label className="field">
        <span className="field-label">Name</span>
        <input className="input" required value=${name} onInput=${(event) => setName(event.target.value)} />
        ${fields.name ? html`<span className="field-error">${fields.name}</span>` : null}
      </label>
      <label className="field">
        <span className="field-label">Slot length (minutes)</span>
        <input className="input" inputMode="numeric" required value=${duration} onInput=${(event) => setDuration(event.target.value)} />
        <span className="field-hint">One length for every teacher on this service.</span>
        ${fields.slot_duration_minutes ? html`<span className="field-error">${fields.slot_duration_minutes}</span>` : null}
      </label>
      <button className="btn btn-primary" type="submit" disabled=${busy}>${busy ? 'Adding…' : 'Add service'}</button>
    </form>` : null}
    ${event.services.length === 0 ? html`<div className="card"><p>No services yet.</p><p className="lede">A service is a bookable offering, such as elementary conferences, with one slot length.</p></div>` : null}
    ${event.services.map((service) => html`<article className="card" key=${service.id}>
      ${editingId === service.id ? html`<form className="form" onSubmit=${saveService}>
        <label className="field">
          <span className="field-label">Name</span>
          <input className="input" required value=${name} onInput=${(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Slot length (minutes)</span>
          <input className="input" inputMode="numeric" required value=${duration} onInput=${(event) => setDuration(event.target.value)} />
        </label>
        <div className="btn-row">
          <button className="btn btn-primary" type="submit" disabled=${busy}>Save service</button>
          <button className="btn btn-secondary" type="button" onClick=${() => setEditingId(null)}>Cancel</button>
        </div>
      </form>` : html`<div>
        <h2>${service.name}</h2>
        <p className="event-meta">${service.slot_duration_minutes} minutes</p>
        <div className="section-gap">
          ${service.staff.length === 0 ? html`<p className="muted">No staff assigned.</p>` : service.staff.map((member) => {
            const room = staffDirectory.find((item) => item.id === member.id)?.powerschool_room;
            const roomText = member.room_override
              ? `Room ${member.room_override} for this service`
              : room
                ? `PowerSchool room ${room}`
                : 'PowerSchool room not set';
            return html`<div className="staff-line" key=${member.id}>
              <div>
                <div className="person-name">${member.display_name}${member.active ? '' : ' (inactive)'}</div>
                <div className="muted">${member.email} · ${roomText}</div>
              </div>
              ${canWrite ? html`<button type="button" className="btn btn-secondary" onClick=${() => unassign(service.id, member.id)}>Remove</button>` : null}
            </div>`;
          })}
        </div>
        ${canWrite ? html`<${AssignRow} service=${service} options=${synced} onAssign=${assign} />` : null}
        ${canWrite ? html`<div className="btn-row section-gap">
          <button type="button" className="btn btn-secondary" onClick=${() => beginEdit(service)}>Edit</button>
          <${DeleteControl} label="Delete this service?" busy=${busy} onConfirm=${() => removeService(service.id)} />
        </div>` : null}
      </div>`}
    </article>`)}
    ${canWrite && directory && synced.length === 0 ? html`<p className="muted">Sync teachers on the Staff screen before assigning them.</p>` : null}
  </div>`;
}

function AssignRow({ service, options, onAssign }) {
  const assigned = new Set(service.staff.map((member) => member.id));
  const available = options.filter((member) => !assigned.has(member.id));
  const [staffId, setStaffId] = useState(available[0] ? String(available[0].id) : '');
  useEffect(() => {
    setStaffId(available[0] ? String(available[0].id) : '');
  }, [service.id, available.map((member) => member.id).join(',')]);

  if (available.length === 0) return null;
  return html`<form className="inline-form section-gap" onSubmit=${(event) => { event.preventDefault(); onAssign(service.id, staffId); }}>
    <select className="input" aria-label=${`Assign staff to ${service.name}`} value=${staffId} onChange=${(event) => setStaffId(event.target.value)}>
      ${available.map((member) => html`<option key=${member.id} value=${member.id}>${member.display_name}${member.powerschool_room ? ` · Room ${member.powerschool_room}` : ''}</option>`)}
    </select>
    <button className="btn btn-secondary" type="submit">Assign</button>
  </form>`;
}

function AvailabilityPanel({ event, user, timeZone }) {
  const canWrite = user.role === 'it_admin';
  const locked = cutoffPassed(event.cutoff_at);
  const staff = useMemo(() => {
    const map = new Map();
    for (const service of event.services) {
      for (const member of service.staff) map.set(member.id, member);
    }
    return [...map.values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [event]);
  const [staffId, setStaffId] = useState(staff[0] ? String(staff[0].id) : '');
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [start, setStart] = useState(`${event.event_date}T08:00`);
  const [end, setEnd] = useState(`${event.event_date}T15:00`);
  const [blockType, setBlockType] = useState('bookable');

  useEffect(() => {
    if (!staff.some((member) => String(member.id) === staffId)) {
      setStaffId(staff[0] ? String(staff[0].id) : '');
    }
  }, [staff, staffId]);

  const load = useCallback(() => {
    if (!staffId) return undefined;
    let live = true;
    setLoading(true);
    setError('');
    api(`/events/${event.id}/staff/${staffId}/availability`)
      .then((data) => { if (live) setBlocks(data.blocks || []); })
      .catch((err) => { if (live) setError(err.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [event.id, staffId]);

  useEffect(() => {
    return load();
  }, [load]);

  function beginEdit(block) {
    setEditingId(block.id);
    setStart(block.start_time.slice(0, 16));
    setEnd(block.end_time.slice(0, 16));
    setBlockType(block.block_type);
    setSuccess('');
    setError('');
  }

  function resetForm() {
    setEditingId(null);
    setStart(`${event.event_date}T08:00`);
    setEnd(`${event.event_date}T15:00`);
    setBlockType('bookable');
  }

  async function submit(formEvent) {
    formEvent.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      if (editingId) {
        await api(`/availability/${editingId}`, {
          method: 'PATCH',
          body: { start_time: start, end_time: end },
        });
        setSuccess('Block saved.');
      } else {
        await api(`/events/${event.id}/staff/${staffId}/availability`, {
          method: 'POST',
          body: { start_time: start, end_time: end, block_type: blockType },
        });
        setSuccess(blockType === 'break' ? 'Block time added.' : 'Bookable time added.');
      }
      resetForm();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(blockId) {
    setBusy(true);
    setError('');
    try {
      await api(`/availability/${blockId}`, { method: 'DELETE' });
      setSuccess('Block deleted.');
      if (editingId === blockId) resetForm();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (staff.length === 0) {
    return html`<div className="card">
      <p>Assign teachers to a service before setting availability.</p>
      <p className="lede"><a className="back" href=${`#/events/${event.id}/services`}>Go to services</a></p>
    </div>`;
  }

  return html`<div className="stack">
    ${success ? html`<div><span className="success-note">${success}</span></div>` : null}
    ${error ? html`<div className="note">${error}</div>` : null}
    <${LockRow} cutoff=${event.cutoff_at} timeZone=${timeZone} />
    <label className="field">
      <span className="field-label">Staff member</span>
      <select className="input" value=${staffId} onChange=${(event) => { setStaffId(event.target.value); resetForm(); }}>
        ${staff.map((member) => html`<option key=${member.id} value=${member.id}>${member.display_name}</option>`)}
      </select>
    </label>
    ${canWrite && !locked ? html`<form className="card form" onSubmit=${submit}>
      <h2>${editingId ? 'Edit block' : 'Add time'}</h2>
      ${editingId ? null : html`<label className="field">
        <span className="field-label">Type</span>
        <select className="input" value=${blockType} onChange=${(event) => setBlockType(event.target.value)}>
          <option value="bookable">Bookable</option>
          <option value="break">Block time</option>
        </select>
      </label>`}
      <label className="field">
        <span className="field-label">Starts</span>
        <input className="input" type="datetime-local" required value=${start} onInput=${(event) => setStart(event.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Ends</span>
        <input className="input" type="datetime-local" required value=${end} onInput=${(event) => setEnd(event.target.value)} />
      </label>
      <div className="btn-row">
        <button className="btn btn-primary" type="submit" disabled=${busy}>${busy ? 'Saving…' : editingId ? 'Save block' : 'Add block'}</button>
        ${editingId ? html`<button type="button" className="btn btn-secondary" onClick=${resetForm}>Cancel</button>` : null}
      </div>
    </form>` : null}
    ${loading ? html`<p className="muted">Loading availability…</p>` : null}
    ${!loading && blocks.length === 0 ? html`<div className="card"><p>No availability yet for this teacher.</p></div>` : null}
    <div className="list">
      ${blocks.map((block) => html`<article key=${block.id} className=${cx('card', block.block_type === 'break' && 'block-break')}>
        <div className="staff-line">
          <div>
            <div className="person-name">${block.block_type === 'break' ? 'Block time' : 'Bookable'}</div>
            <div className="event-meta">${formatWhen(block.start_time)} – ${formatWhen(block.end_time)}</div>
          </div>
          <span className="pill">${block.block_type === 'break' ? 'Break' : 'Bookable'}</span>
        </div>
        ${canWrite && !locked ? html`<div className="btn-row section-gap">
          <button type="button" className="btn btn-secondary" onClick=${() => beginEdit(block)}>Edit</button>
          <${DeleteControl} label="Delete this block?" busy=${busy} onConfirm=${() => remove(block.id)} />
        </div>` : null}
      </article>`)}
    </div>
  </div>`;
}

function StaffScreen({ user }) {
  const canWrite = user.role === 'it_admin';
  const [state, setState] = useState({ loading: true, error: null, source: '', warning: '', staff: [] });
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');

  const load = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }));
    api('/staff')
      .then((data) => setState({
        loading: false,
        error: null,
        source: data.source || '',
        warning: data.warning || '',
        staff: data.staff || [],
      }))
      .catch((error) => setState({ loading: false, error, source: '', warning: '', staff: [] }));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function sync() {
    setBusy(true);
    setSuccess('');
    try {
      const data = await api('/staff/sync', { method: 'POST', body: {} });
      const place = data.source === 'mock' ? 'the PowerSchool stand-in' : 'PowerSchool';
      setSuccess(`Synced ${data.created + data.updated + data.unchanged} teachers from ${place}.`);
      load();
    } catch (error) {
      setState((current) => ({ ...current, error }));
    } finally {
      setBusy(false);
    }
  }

  const unsynced = state.staff.filter((member) => !member.synced).length;

  return html`<${Shell} user=${user} active="staff">
    <div className="screen-head">
      <div>
        <h1>Staff</h1>
        <p className="lede">Teachers come from PowerSchool. Display name and photo stay as you set them.</p>
      </div>
      ${canWrite && !state.error ? html`<button type="button" className="btn btn-primary" disabled=${busy} onClick=${sync}>${busy ? 'Syncing…' : 'Sync from PowerSchool'}</button>` : null}
      ${state.error ? html`<button type="button" className="btn btn-primary" onClick=${load}>Try again</button>` : null}
    </div>
    <div className="stack">
      <${AccessNote} user=${user} />
      ${success ? html`<div><span className="success-note">${success}</span></div>` : null}
      ${state.warning ? html`<div className="note">${state.warning}</div>` : null}
      ${state.source === 'mock' ? html`<p className="muted">Showing the PowerSchool stand-in. Set PSAPI credentials to sync the live teacher list.</p>` : null}
      ${unsynced > 0 ? html`<p className="muted">${unsynced === 1 ? '1 teacher is not saved locally yet.' : `${unsynced} teachers are not saved locally yet.`} Sync to add them.</p>` : null}
      ${state.loading ? html`<p className="muted">Loading staff…</p>` : null}
      ${state.error ? html`<div className="note">${state.error.message}</div>` : null}
      ${!state.loading && !state.error && state.staff.length === 0 ? html`<div className="card">
        <p>No teachers on file.</p>
        <p className="lede">Sync from PowerSchool to pull the current staff list.</p>
      </div>` : null}
      <div className="list">
        ${state.staff.map((member) => {
          const inner = html`<div className="person">
            <${Avatar} name=${member.display_name} photo=${member.photo_url} />
            <span>
              <span className="person-name">${member.display_name}</span>
              <span className="event-meta">${member.email}${member.powerschool_room ? ` · Room ${member.powerschool_room}` : ''}</span>
            </span>
          </div>`;
          const meta = html`<span className="pill">${member.synced ? (member.active ? 'Active' : 'Inactive') : 'Not synced'}</span>`;
          if (!member.id) {
            return html`<div className="card staff-line" key=${member.powerschool_teacher_id}>${inner}${meta}</div>`;
          }
          return html`<a className="card staff-line" href=${`#/staff/${member.id}`} key=${member.id}>${inner}${meta}</a>`;
        })}
      </div>
    </div>
  </${Shell}>`;
}

function Avatar({ name, photo }) {
  const [failed, setFailed] = useState(false);
  if (photo && !failed) {
    return html`<span className="avatar"><img src=${photo} alt="" onError=${() => setFailed(true)} /></span>`;
  }
  return html`<span className="avatar" aria-hidden="true">${initials(name)}</span>`;
}

function StaffEditScreen({ user, staffId }) {
  const id = positiveId(staffId);
  const canWrite = user.role === 'it_admin';
  const [member, setMember] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState('');
  const [active, setActive] = useState(true);
  const [fields, setFields] = useState({});
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return undefined;
    let live = true;
    setLoading(true);
    api('/staff')
      .then((data) => {
        if (!live) return;
        const found = (data.staff || []).find((item) => item.id === id);
        if (!found) {
          setError('That staff member is not on file. Sync from PowerSchool first.');
          setMember(null);
        } else {
          setMember(found);
          setName(found.display_name);
          setPhoto(found.photo_url || '');
          setActive(found.active);
          setError('');
        }
      })
      .catch((err) => { if (live) setError(err.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [id]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setFormError('');
    setFields({});
    setSuccess('');
    try {
      const data = await api(`/staff/${id}`, {
        method: 'PATCH',
        body: { display_name: name, photo_url: photo.trim() || null, active },
      });
      setMember((current) => ({ ...current, ...data.staff }));
      setSuccess('Staff saved.');
    } catch (err) {
      const mapped = fieldMap(err);
      setFields(mapped);
      setFormError(Object.keys(mapped).length ? '' : err.message);
    } finally {
      setBusy(false);
    }
  }

  return html`<${Shell} user=${user} active="staff">
    <a className="back" href="#/staff">Staff</a>
    ${!id ? html`<div className="note section-gap">That staff member does not exist.</div>` : null}
    ${loading ? html`<p className="muted section-gap">Loading staff…</p>` : null}
    ${error ? html`<div className="note section-gap">${error}</div>` : null}
    ${member ? html`<div className="section-gap">
      <div className="screen-head">
        <div>
          <h1>${member.display_name}</h1>
          <p className="lede">${member.email} · PowerSchool ${member.powerschool_teacher_id}</p>
        </div>
      </div>
      ${canWrite ? html`<form className="card form" onSubmit=${submit}>
        ${success ? html`<div><span className="success-note">${success}</span></div>` : null}
        ${formError ? html`<div className="note">${formError}</div>` : null}
        <label className="field">
          <span className="field-label">Display name</span>
          <input className="input" required value=${name} onInput=${(event) => setName(event.target.value)} />
          <span className="field-hint">Sync will not overwrite this.</span>
          ${fields.display_name ? html`<span className="field-error">${fields.display_name}</span>` : null}
        </label>
        <label className="field">
          <span className="field-label">Photo URL</span>
          <input className="input" type="url" value=${photo} placeholder="https://" onInput=${(event) => setPhoto(event.target.value)} />
          ${fields.photo_url ? html`<span className="field-error">${fields.photo_url}</span>` : null}
        </label>
        <div className="switch-row">
          <div>
            <div className="field-label">Active</div>
            <div className="field-hint">Inactive teachers stay on file and are left out of new assignments.</div>
          </div>
          <button type="button" className=${cx('toggle', active && 'on')} role="switch" aria-checked=${active ? 'true' : 'false'} aria-label="Active" onClick=${() => setActive((value) => !value)}>
            <span className="toggle-knob"></span>
          </button>
        </div>
        <button className="btn btn-primary" type="submit" disabled=${busy}>${busy ? 'Saving…' : 'Save'}</button>
      </form>` : html`<div className="card">
        <div className="data-row"><div className="data-label">Display name</div><div className="data-value">${member.display_name}</div></div>
        <div className="data-row"><div className="data-label">Email</div><div className="data-value">${member.email}</div></div>
        <div className="data-row"><div className="data-label">Active</div><div className="data-value">${member.active ? 'Yes' : 'No'}</div></div>
        <div className="data-row"><div className="data-label">PowerSchool room</div><div className="data-value">${member.powerschool_room || 'Not set'}</div></div>
      </div>`}
    </div>` : null}
  </${Shell}>`;
}

function App() {
  const route = useRoute();
  const [user, setUser] = useState(undefined);
  const [auth, setAuth] = useState({ local: true, google: false });
  const [timeZone, setTimeZone] = useState('Asia/Bangkok');

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener('ptc-unauthorized', onUnauthorized);
    api('/auth/session', { allow401: true })
      .then((data) => {
        setUser(data.user);
        setTimeZone(data.time_zone || 'Asia/Bangkok');
        if (data.auth) setAuth(data.auth);
      })
      .catch((error) => {
        setUser(null);
        if (error.payload?.auth) setAuth(error.payload.auth);
      });
    return () => window.removeEventListener('ptc-unauthorized', onUnauthorized);
  }, []);

  useEffect(() => {
    const titles = {
      events: 'Conferences',
      'event-new': 'New conference',
      event: 'Conference',
      services: 'Services',
      availability: 'Availability',
      staff: 'Staff',
      'staff-edit': 'Staff',
      'sign-in': 'Sign in',
    };
    document.title = `${titles[route.name] || 'Conferences'} — Nakornpayap International School`;
  }, [route.name]);

  async function signOut() {
    try { await api('/auth/session', { method: 'DELETE' }); } catch { /* cookie cleared or already gone */ }
    setUser(null);
    window.location.hash = '#/sign-in';
  }

  if (user === undefined) {
    return html`<div>
      <header className="app-header"><${Logo} /></header>
      <main className="main"><p className="muted">Loading…</p></main>
    </div>`;
  }

  if (!user) {
    return html`<${SignIn} auth=${auth} notice=${signInMessage(route.error)} onSignedIn=${(data) => {
      setUser(data.user);
      if (data.time_zone) setTimeZone(data.time_zone);
      if (data.auth) setAuth(data.auth);
    }} />`;
  }

  if (route.name === 'event-new') return html`<${NewEventScreen} user=${user} />`;
  if (route.name === 'event') return html`<${EventWorkspace} user=${user} eventId=${route.id} section="details" timeZone=${timeZone} />`;
  if (route.name === 'services') return html`<${EventWorkspace} user=${user} eventId=${route.id} section="services" timeZone=${timeZone} />`;
  if (route.name === 'availability') return html`<${EventWorkspace} user=${user} eventId=${route.id} section="availability" timeZone=${timeZone} />`;
  if (route.name === 'staff') return html`<${StaffScreen} user=${user} />`;
  if (route.name === 'staff-edit') return html`<${StaffEditScreen} user=${user} staffId=${route.id} />`;
  return html`<${EventsScreen} user=${user} />`;
}

ReactDOM.createRoot(document.getElementById('root')).render(html`<${App} />`);
