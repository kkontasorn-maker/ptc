const html = htm.bind(React.createElement);
const { useCallback, useEffect, useMemo, useRef, useState } = React;

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
  const parts = (pathPart || '/').split('/').filter(Boolean);
  const error = query.get('error');
  if (!parts.length) return { name: 'landing' };
  if (parts[0] === 'landing-page') return { name: 'landing-page' };
  if (parts[0] === 'verify') {
    const returnTo = query.get('return') || '';
    return {
      name: 'verify',
      returnTo: /^book\/[1-9]\d*$/.test(returnTo) ? returnTo : '',
      email: query.get('email') || '',
    };
  }
  if (parts[0] === 'book' && parts[1]) return { name: 'book', id: parts[1] };
  if (parts[0] === 'agenda') return parts[1] ? { name: 'agenda', id: parts[1] } : { name: 'agenda' };
  if (parts[0] === 'sign-in') return { name: 'sign-in', error };
  if (parts[0] === 'notifications') return { name: 'notifications' };
  if (parts[0] === 'staff') {
    return parts[1] ? { name: 'staff-edit', id: parts[1] } : { name: 'staff' };
  }
  if (parts[0] === 'events') {
    if (!parts[1]) return { name: 'events' };
    if (parts[1] === 'new') return { name: 'event-new' };
    if (parts[2] === 'services') return { name: 'services', id: parts[1] };
    if (parts[2] === 'availability') return { name: 'availability', id: parts[1] };
    if (parts[2] === 'custom-fields') return { name: 'custom-fields', id: parts[1] };
    if (parts[2] === 'bookings') return { name: 'bookings', id: parts[1] };
    if (!parts[2]) return { name: 'event', id: parts[1] };
  }
  return { name: 'landing' };
}

function useRoute() {
  const [hash, setHash] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    if (!window.location.hash) window.location.hash = '#/';
    const onChange = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return parseRoute(hash);
}

function Logo({ href = '#/' }) {
  return html`<a className="logo" href=${href}>
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

function IconMail() {
  return html`<svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3.5" y="5.5" width="17" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M4 7l8 6 8-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
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

function IconAgenda() {
  return html`<svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M8 8h8M8 12h8M8 16h5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>`;
}

function IconHome() {
  return html`<svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4.5 11.5 12 5l7.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M7 10.5V19h10v-8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>`;
}

function Shell({ user, active, onSignOut, children }) {
  const home = user.role === 'teacher' ? '#/agenda' : '#/events';
  return html`<div>
    <header className="app-header">
      <${Logo} href=${home} />
      <nav className="nav" aria-label="Sections">
        ${user.role === 'teacher' ? html`<a href="#/agenda" className=${active === 'agenda' ? 'active' : ''} aria-current=${active === 'agenda' ? 'page' : undefined}>
          <${IconAgenda} /> Agenda
        </a>` : null}
        <a href="#/events" className=${active === 'events' ? 'active' : ''} aria-current=${active === 'events' ? 'page' : undefined}>
          <${IconCalendar} /> Conferences
        </a>
        <a href="#/staff" className=${active === 'staff' ? 'active' : ''} aria-current=${active === 'staff' ? 'page' : undefined}>
          <${IconPeople} /> Staff
        </a>
        ${user.role === 'it_admin' ? html`<a href="#/landing-page" className=${active === 'landing-page' ? 'active' : ''} aria-current=${active === 'landing-page' ? 'page' : undefined}>
          <${IconHome} /> Landing page
        </a>` : null}
        ${user.role === 'it_admin' || user.role === 'front_office' ? html`<a href="#/notifications" className=${active === 'notifications' ? 'active' : ''} aria-current=${active === 'notifications' ? 'page' : undefined}>
          <${IconMail} /> Notification issues
        </a>` : null}
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
    ? 'Front office can review conferences, the booking report, and notification issues. Changes are limited to IT admin.'
    : user.role === 'teacher'
      ? 'Your schedule is on Agenda. This screen is read-only.'
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
      window.location.hash = data.user?.role === 'teacher' ? '#/agenda' : '#/events';
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
          <p className="muted quiet-link"><a href="#/">Back to home</a></p>
          <p className="muted quiet-link"><a href="#/verify">Verify your email</a></p>
        </div>
      </div>
    </main>
  </div>`;
}

function VerifyEmailScreen({ returnTo = '', initialEmail = '' }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [children, setChildren] = useState(null);
  const [unmatched, setUnmatched] = useState(false);
  const [contactType, setContactType] = useState('line');
  const [contactValue, setContactValue] = useState('');

  function reset() {
    setStep('email');
    setCode('');
    setDevCode('');
    setError('');
    setChildren(null);
    setUnmatched(false);
    setContactType('line');
    setContactValue('');
  }

  async function loadChildren(address) {
    const data = await api(`/parents/me/children?email=${encodeURIComponent(address)}`, { allow401: true });
    try { sessionStorage.setItem('ptcParentEmail', address); } catch { /* private mode */ }
    setChildren(data.children || []);
    setUnmatched(false);
    setStep('contact');
  }

  function skipContact() {
    setError('');
    setStep('done');
  }

  async function saveContact(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/parents/me/contact-preference', {
        method: 'PATCH',
        body: {
          email: email.trim(),
          fallback_contact_type: contactType,
          fallback_contact_value: contactValue.trim(),
        },
        allow401: true,
      });
      setStep('done');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function continueEmail(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setDevCode('');
    const address = email.trim();
    try {
      const status = await api(`/auth/device-status?email=${encodeURIComponent(address)}`, { allow401: true });
      if (status.verified) {
        await loadChildren(address);
        return;
      }
      const sent = await api('/auth/verification-codes', {
        method: 'POST',
        body: { email: address },
        allow401: true,
      });
      setDevCode(sent.dev_code || '');
      setStep('code');
    } catch (err) {
      if (err.code === 'NO_STUDENT_MATCH') {
        setUnmatched(true);
        setChildren(null);
        setStep('done');
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const address = email.trim();
    try {
      await api('/auth/verification-codes/confirm', {
        method: 'POST',
        body: { email: address, code: code.trim() },
        allow401: true,
      });
      await loadChildren(address);
    } catch (err) {
      if (err.code === 'NO_STUDENT_MATCH') {
        setUnmatched(true);
        setChildren(null);
        setStep('done');
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const childRows = children || [];

  return html`<div>
    <header className="app-header"><${Logo} href="#/verify" /></header>
    <main className="main">
      <div className="signin">
        <div className="screen-head">
          <div>
            <h1>Verify your email</h1>
            <p className="lede">We'll match this address to your children in the school records. You can do this before conferences open.</p>
          </div>
        </div>
        <div className="stack">
          ${error ? html`<div className="note">${error}</div>` : null}
          ${step === 'email' ? html`<form className="card form" onSubmit=${continueEmail}>
            <label className="field">
              <span className="field-label">Email</span>
              <input className="input" type="email" name="email" autoComplete="email" required value=${email} placeholder="name@example.com" onInput=${(event) => setEmail(event.target.value)} />
            </label>
            <button className="btn btn-primary" type="submit" disabled=${busy}>${busy ? 'Checking…' : 'Continue'}</button>
          </form>` : null}
          ${step === 'code' ? html`<form className="card form" onSubmit=${confirmCode}>
            <p className="muted">Enter the 6-digit code sent to ${email.trim()}. It expires in 10 minutes.</p>
            <label className="field">
              <span className="field-label">Code</span>
              <input className="input" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength="6" pattern="[0-9]{6}" value=${code} onInput=${(event) => setCode(event.target.value)} />
              ${devCode ? html`<span className="field-hint">Mail is not configured on this server. Your code is ${devCode}.</span>` : null}
            </label>
            <button className="btn btn-primary" type="submit" disabled=${busy}>${busy ? 'Checking…' : 'Verify'}</button>
            <button className="btn btn-secondary" type="button" onClick=${reset}>Use a different email</button>
          </form>` : null}
          ${step === 'contact' ? html`<form className="card form" onSubmit=${saveContact}>
            <p className="muted">If email does not reach you, front office can use another way to get in touch. This is optional.</p>
            <label className="field">
              <span className="field-label">How else can we reach you?</span>
              <select className="input" value=${contactType} onChange=${(event) => setContactType(event.target.value)}>
                <option value="line">LINE</option>
                <option value="phone">Phone</option>
                <option value="wechat">WeChat</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">${contactType === 'phone' ? 'Phone number' : contactType === 'wechat' ? 'WeChat ID' : 'LINE ID'}</span>
              <input className="input" name="fallback" value=${contactValue} onInput=${(event) => setContactValue(event.target.value)} />
            </label>
            <button className="btn btn-primary" type="submit" disabled=${busy}>${busy ? 'Saving…' : 'Save contact'}</button>
            <button className="btn btn-secondary" type="button" onClick=${skipContact}>Skip</button>
          </form>` : null}
          ${step === 'done' && unmatched ? html`<div className="card">
            <p>We couldn't match this email to a student. Please contact the front office.</p>
            <button className="btn btn-secondary section-gap" type="button" onClick=${reset}>Use a different email</button>
          </div>` : null}
          ${step === 'done' && !unmatched ? html`<div className="card">
            <div><span className="success-note">We found your children</span></div>
            ${childRows.map((child) => html`<div className="data-row" key=${child.student_powerschool_id}>
              <div className="data-label">${child.grade ? `Grade ${child.grade}` : 'Grade not set'}</div>
              <div className="data-value">${child.name}${child.nickname ? ` (${child.nickname})` : ''}</div>
            </div>`)}
            ${returnTo ? html`<a className="btn btn-primary section-gap" href=${`#/${returnTo}`}>Book conferences</a>` : null}
            <button className="btn btn-secondary section-gap" type="button" onClick=${reset}>Use a different email</button>
          </div>` : null}
          <p className="muted quiet-link"><a href="#/sign-in">Staff sign-in</a></p>
        </div>
      </div>
    </main>
  </div>`;
}

function formatClock(iso) {
  return iso ? iso.slice(11, 16) : '';
}

function BookingScreen({ eventId }) {
  const id = positiveId(eventId);
  const storedEmail = (() => {
    try { return sessionStorage.getItem('ptcParentEmail') || ''; } catch { return ''; }
  })();
  const [email, setEmail] = useState(storedEmail);
  const [phase, setPhase] = useState(storedEmail && id ? 'loading' : 'email');
  const [view, setView] = useState(null);
  const [childId, setChildId] = useState('');
  const [selected, setSelected] = useState([]);
  const [relationship, setRelationship] = useState('mother');
  const [relationshipOther, setRelationshipOther] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState('');
  const [locked, setLocked] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [moving, setMoving] = useState(null);
  const [moveSlot, setMoveSlot] = useState(null);
  const [customAnswers, setCustomAnswers] = useState({});

  const load = useCallback(async (address) => {
    setPhase('loading');
    setError('');
    setLocked('');
    try {
      const status = await api(`/auth/device-status?email=${encodeURIComponent(address)}`, { allow401: true });
      if (!status.verified) {
        window.location.hash = `#/verify?return=book/${id}&email=${encodeURIComponent(address)}`;
        return;
      }
      const data = await api(`/events/${id}/parent-view?email=${encodeURIComponent(address)}`, { allow401: true });
      setView(data);
      setChildId((current) => current || data.children?.[0]?.student_powerschool_id || '');
      setCustomAnswers((current) => {
        const next = {};
        for (const field of data.custom_field_definitions || []) {
          next[field.id] = current[field.id] || '';
        }
        return next;
      });
      setPhase('grid');
    } catch (err) {
      if (err.status === 401) {
        window.location.hash = `#/verify?return=book/${id}&email=${encodeURIComponent(address)}`;
        return;
      }
      setError(err.message);
      setPhase(err.code === 'NO_STUDENT_MATCH' ? 'unmatched' : 'error');
    }
  }, [id]);

  useEffect(() => {
    if (id && storedEmail) load(storedEmail);
  }, [id, storedEmail, load]);

  function toggleSlot(child, teacher, slot) {
    if (!slot.available || locked) return;
    const key = `${child.student_powerschool_id}|${teacher.staff_id}|${teacher.service_id}|${slot.start_time}`;
    setSelected((current) => {
      const exists = current.some((item) => item.key === key);
      if (exists) return current.filter((item) => item.key !== key);
      return [...current, {
        key,
        student_powerschool_id: child.student_powerschool_id,
        student_name: child.name,
        service_id: teacher.service_id,
        staff_id: teacher.staff_id,
        display_name: teacher.display_name,
        room: teacher.room,
        start_time: slot.start_time,
        end_time: slot.end_time,
      }];
    });
  }

  async function submitVisit(event) {
    event.preventDefault();
    if (!selected.length || locked) return;
    const definitions = view?.custom_field_definitions || [];
    const missing = definitions.find((field) => (
      field.required && !(customAnswers[field.id] || '').trim()
    ));
    if (missing) {
      setError(`Please answer "${missing.label}".`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const custom_field_values = definitions
        .map((field) => ({
          field_id: field.id,
          value: (customAnswers[field.id] || '').trim(),
        }))
        .filter((item) => item.value.length > 0);
      const body = {
        parent_email: email.trim(),
        parent_relationship: relationship,
        picks: selected.map((item) => ({
          student_powerschool_id: item.student_powerschool_id,
          service_id: item.service_id,
          staff_id: item.staff_id,
          start_time: item.start_time,
          end_time: item.end_time,
        })),
      };
      if (custom_field_values.length) body.custom_field_values = custom_field_values;
      if (relationship === 'other') body.parent_relationship_other = relationshipOther.trim();
      if (firstName.trim()) body.parent_first_name = firstName.trim();
      if (lastName.trim()) body.parent_last_name = lastName.trim();
      const data = await api('/bookings', { method: 'POST', body, allow401: true });
      setConfirmation(data);
      setSelected([]);
      setPhase('confirmed');
      await loadQuiet();
    } catch (err) {
      if (err.status === 423) setLocked(err.message);
      else setError(err.message);
      if (err.status === 409) await loadQuiet();
    } finally {
      setBusy(false);
    }
  }

  async function loadQuiet() {
    try {
      const data = await api(`/events/${id}/parent-view?email=${encodeURIComponent(email.trim())}`, { allow401: true });
      setView(data);
    } catch { /* confirmation still stands */ }
  }

  async function cancelVisit() {
    if (!confirmation?.booking_batch_id) return;
    setBusy(true);
    setError('');
    try {
      await api(`/bookings/batch/${confirmation.booking_batch_id}`, { method: 'DELETE', allow401: true });
      setConfirmation(null);
      setError('');
      setPhase('cancelled');
      await loadQuiet();
    } catch (err) {
      if (err.status === 423) setLocked(err.message);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelOne(booking) {
    setBusy(true);
    setError('');
    try {
      await api(`/bookings/${booking.id}`, { method: 'DELETE', allow401: true });
      const remaining = (confirmation?.bookings || []).filter((item) => item.id !== booking.id);
      setConfirmation(remaining.length ? { ...confirmation, bookings: remaining } : null);
      if (!remaining.length) setPhase('cancelled');
      await loadQuiet();
    } catch (err) {
      if (err.status === 423) setLocked(err.message);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function startMove(booking) {
    setMoving(booking);
    setMoveSlot(null);
    setError('');
    setPhase('move');
  }

  async function saveMove(event) {
    event.preventDefault();
    if (!moving || !moveSlot) return;
    setBusy(true);
    setError('');
    try {
      const data = await api(`/bookings/${moving.id}/reschedule`, {
        method: 'PATCH',
        allow401: true,
        body: { start_time: moveSlot.start_time, end_time: moveSlot.end_time },
      });
      setConfirmation((current) => ({
        ...current,
        bookings: (current?.bookings || []).map((item) => (item.id === data.booking.id ? data.booking : item)),
      }));
      setMoving(null);
      setMoveSlot(null);
      setPhase('confirmed');
      await loadQuiet();
    } catch (err) {
      if (err.status === 423) {
        setLocked(err.message);
        setPhase('confirmed');
      } else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const child = view?.children?.find((item) => item.student_powerschool_id === childId) || view?.children?.[0];
  const customDefs = view?.custom_field_definitions || [];
  const held = [];
  for (const person of view?.children || []) {
    for (const teacher of person.teachers || []) {
      if (!teacher.already_booked) continue;
      held.push({
        key: `held-${teacher.already_booked.booking_id}`,
        student_name: person.name,
        display_name: teacher.display_name,
        room: teacher.room,
        start_time: teacher.already_booked.start_time,
        end_time: teacher.already_booked.end_time,
      });
    }
  }

  if (!id) {
    return html`<div>
      <header className="app-header"><${Logo} href="#/verify" /></header>
      <main className="main"><div className="note">This conference is not open.</div></main>
    </div>`;
  }

  return html`<div>
    <header className="app-header"><${Logo} href="#/verify" /></header>
    <main className="main book-main">
      <div className="screen-head">
        <div>
          <h1>Book a conference</h1>
          <p className="lede">Choose a time with each teacher. One visit is confirmed together.</p>
        </div>
      </div>
      ${error ? html`<div className="note section-gap">${error}</div>` : null}
      ${locked ? html`<div className="lock-row section-gap">${html`<${IconLock} />`}<span>${locked}</span></div>` : null}
      ${phase === 'email' ? html`<form className="card form" onSubmit=${(event) => { event.preventDefault(); const address = email.trim(); try { sessionStorage.setItem('ptcParentEmail', address); } catch { /* private mode */ } load(address); }}>
        <label className="field">
          <span className="field-label">Email</span>
          <input className="input" type="email" required value=${email} placeholder="name@example.com" onInput=${(event) => setEmail(event.target.value)} />
        </label>
        <button className="btn btn-primary" type="submit">Continue</button>
      </form>` : null}
      ${phase === 'loading' ? html`<p className="muted">Loading the schedule…</p>` : null}
      ${phase === 'unmatched' ? html`<div className="card"><p>We couldn't match this email to a student. Please contact the front office.</p></div>` : null}
      ${phase === 'error' ? html`<p className="muted quiet-link"><a href="#/verify">Verify your email</a></p>` : null}
      ${phase === 'cancelled' ? html`<div className="card"><p>This visit was cancelled.</p><button className="btn btn-secondary section-gap" type="button" onClick=${() => { setPhase('grid'); setError(''); }}>Choose new times</button></div>` : null}
      ${phase === 'grid' && view ? html`<div className="book-layout">
        <div>
          <div className="child-tabs" role="tablist" aria-label="Children">
            ${(view.children || []).map((person) => html`<button type="button" role="tab" key=${person.student_powerschool_id} className="child-tab" aria-selected=${person.student_powerschool_id === child?.student_powerschool_id ? 'true' : 'false'} onClick=${() => setChildId(person.student_powerschool_id)}>
              ${person.name}
            </button>`)}
          </div>
          ${child && !(child.teachers || []).length ? html`<div className="card"><p>No teachers on this conference for ${child.name}.</p></div>` : null}
          <div className="teacher-grid">
            ${(child?.teachers || []).map((teacher) => html`<article className="card teacher-card" key=${`${teacher.staff_id}-${teacher.service_id}`}>
              <h2>${teacher.display_name}</h2>
              <p className="muted">${teacher.room ? `Room ${teacher.room}` : 'Room not set'}</p>
              ${teacher.booked_by_other_guardian ? html`<${QuietLock} message=${`Already booked — ${teacher.booked_by_other_guardian.relationship}, ${formatClock(teacher.booked_by_other_guardian.start_time)}.`} />` : null}
              <div className="slot-grid">
                ${teacher.slots.map((slot) => {
                  const key = `${child.student_powerschool_id}|${teacher.staff_id}|${teacher.service_id}|${slot.start_time}`;
                  const isSelected = selected.some((item) => item.key === key);
                  const taken = !slot.available;
                  return html`<button type="button" key=${slot.start_time} className=${cx('slot-btn', isSelected && 'selected', taken && 'taken')} disabled=${taken || Boolean(locked)} aria-pressed=${isSelected ? 'true' : 'false'} onClick=${() => toggleSlot(child, teacher, slot)}>
                    ${formatClock(slot.start_time)}–${formatClock(slot.end_time)}
                  </button>`;
                })}
              </div>
              ${teacher.already_booked ? html`<p className="booked-note">Booked ${formatClock(teacher.already_booked.start_time)}–${formatClock(teacher.already_booked.end_time)}</p>` : null}
            </article>`)}
          </div>
        </div>
        <form className="card day-so-far" onSubmit=${submitVisit}>
          <h2>Day so far</h2>
          ${!held.length && !selected.length ? html`<p className="muted">No times selected yet.</p>` : null}
          ${held.map((item) => html`<div className="data-row" key=${item.key}>
            <div className="data-label">${formatClock(item.start_time)}–${formatClock(item.end_time)}</div>
            <div className="data-value">${item.student_name} · ${item.display_name}${item.room ? ` · Room ${item.room}` : ''}</div>
          </div>`)}
          ${selected.map((item) => html`<div className="data-row" key=${item.key}>
            <div className="data-label">${formatClock(item.start_time)}–${formatClock(item.end_time)}</div>
            <div className="data-value">${item.student_name} · ${item.display_name}${item.room ? ` · Room ${item.room}` : ''}</div>
          </div>`)}
          <label className="field">
            <span className="field-label">Relationship</span>
            <select className="input" value=${relationship} onChange=${(event) => setRelationship(event.target.value)}>
              <option value="mother">Mother</option>
              <option value="father">Father</option>
              <option value="guardian">Guardian</option>
              <option value="other">Other</option>
            </select>
          </label>
          ${relationship === 'other' ? html`<label className="field">
            <span className="field-label">Describe the relationship</span>
            <input className="input" required value=${relationshipOther} onInput=${(event) => setRelationshipOther(event.target.value)} />
          </label>` : null}
          <label className="field">
            <span className="field-label">First name</span>
            <input className="input" value=${firstName} onInput=${(event) => setFirstName(event.target.value)} />
            <span className="field-hint">Optional. Used on the confirmation only.</span>
          </label>
          <label className="field">
            <span className="field-label">Last name</span>
            <input className="input" value=${lastName} onInput=${(event) => setLastName(event.target.value)} />
          </label>
          ${customDefs.length ? html`<div className="custom-fields-block">
            <h3 className="custom-fields-heading">Additional questions</h3>
            ${customDefs.map((field) => html`<label className="field" key=${field.id}>
              <span className="field-label">${field.label}${field.required ? ' *' : ''}</span>
              <input
                className="input"
                maxLength="500"
                required=${Boolean(field.required)}
                value=${customAnswers[field.id] || ''}
                onInput=${(event) => setCustomAnswers((current) => ({ ...current, [field.id]: event.target.value }))}
              />
            </label>`)}
          </div>` : null}
          <button className="btn btn-primary" type="submit" disabled=${busy || !selected.length || Boolean(locked)}>${busy ? 'Booking…' : 'Confirm visit'}</button>
        </form>
      </div>` : null}
      ${phase === 'confirmed' && confirmation ? html`<div className="card">
        <div><span className="success-note">Booking confirmed.</span></div>
        ${(confirmation.bookings || []).map((booking) => html`<div className="data-row" key=${booking.id}>
          <div className="data-label">${formatClock(booking.start_time)}–${formatClock(booking.end_time)}</div>
          <div className="data-value">
            ${booking.student_name} · ${booking.display_name}${booking.room ? ` · Room ${booking.room}` : ''}
            <div className="row-actions">
              <button type="button" className="text-button" onClick=${() => startMove(booking)} disabled=${Boolean(locked) || busy}>Change time</button>
              <button type="button" className="text-button" onClick=${() => cancelOne(booking)} disabled=${Boolean(locked) || busy}>Cancel this time</button>
            </div>
          </div>
        </div>`)}
        <button className="btn btn-secondary section-gap" type="button" disabled=${busy || Boolean(locked)} onClick=${cancelVisit}>Cancel this visit</button>
      </div>` : null}
      ${phase === 'move' && moving ? html`<form className="card form" onSubmit=${saveMove}>
        <h2>Change time</h2>
        <p className="lede">${moving.student_name} · ${moving.display_name}</p>
        <div className="slot-grid">
          ${moveChoices(view, moving).map((slot) => html`<button type="button" key=${slot.start_time} className=${cx('slot-btn', moveSlot?.start_time === slot.start_time && 'selected', !slot.available && slot.start_time !== moving.start_time && 'taken')} disabled=${(!slot.available && slot.start_time !== moving.start_time) || Boolean(locked)} onClick=${() => setMoveSlot(slot)}>
            ${formatClock(slot.start_time)}–${formatClock(slot.end_time)}
          </button>`)}
        </div>
        <button className="btn btn-primary" type="submit" disabled=${busy || !moveSlot || Boolean(locked)}>${busy ? 'Saving…' : 'Save time'}</button>
        <button className="btn btn-secondary" type="button" onClick=${() => { setPhase('confirmed'); setMoving(null); }}>Back</button>
      </form>` : null}
    </main>
  </div>`;
}

function moveChoices(view, booking) {
  for (const child of view?.children || []) {
    if (child.student_powerschool_id !== booking.student_powerschool_id) continue;
    for (const teacher of child.teachers || []) {
      if (teacher.staff_id === booking.staff_id && teacher.service_id === booking.service_id) return teacher.slots;
    }
  }
  return [];
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

function PowerSchoolCard() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    api('/admin/integrations/powerschool-status')
      .then((data) => {
        setStatus(data);
        setNote('');
      })
      .catch((error) => setNote(error.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function testConnection() {
    setBusy(true);
    setNote('');
    try {
      const data = await api('/admin/integrations/powerschool-status/test', { method: 'POST', body: {} });
      setStatus(data);
    } catch (error) {
      setNote(error.message);
    } finally {
      setBusy(false);
    }
  }

  const connected = Boolean(status?.connected);
  return html`<article className="card">
    <div className="title-row">
      <h2>PowerSchool</h2>
      <span className="pill">${status ? (connected ? 'Connected' : 'Not connected') : 'Checking…'}</span>
    </div>
    <div className="data-row">
      <div className="data-label">Last successful call</div>
      <div className="data-value">${status?.last_successful_call_at ? formatWhen(status.last_successful_call_at) : 'None yet'}</div>
    </div>
    ${status?.error ? html`<p className="muted section-gap">${status.error}</p>` : null}
    ${note ? html`<p className="muted section-gap">${note}</p>` : null}
    <div className="btn-row section-gap">
      <button type="button" className="btn btn-secondary" disabled=${busy} onClick=${testConnection}>${busy ? 'Testing…' : 'Test connection'}</button>
    </div>
  </article>`;
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
      ${canWrite ? html`<${PowerSchoolCard} />` : null}
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
        <span className="field-hint">Optional. After this time, booking and availability changes lock, and each parent gets one summary email.</span>
        ${fields.cutoff_at ? html`<span className="field-error">${fields.cutoff_at}</span>` : null}
      </label>
      <div className="btn-row">
        <button className="btn btn-primary" type="submit" disabled=${busy}>${busy ? 'Creating…' : 'Create conference'}</button>
        <a className="btn btn-secondary" href="#/events">Cancel</a>
      </div>
    </form>` : html`<div className="note">You do not have access to this action.</div>`}
  </${Shell}>`;
}

function Subnav({ id, section, user }) {
  const canReport = user.role === 'it_admin' || user.role === 'front_office';
  return html`<nav className="subnav" aria-label="Conference">
    <a href=${`#/events/${id}`} className=${section === 'details' ? 'active' : ''}>Details</a>
    <a href=${`#/events/${id}/services`} className=${section === 'services' ? 'active' : ''}>Schools</a>
    <a href=${`#/events/${id}/availability`} className=${section === 'availability' ? 'active' : ''}>Availability</a>
    ${canReport ? html`<a href=${`#/events/${id}/custom-fields`} className=${section === 'custom-fields' ? 'active' : ''}>Custom fields</a>` : null}
    ${canReport ? html`<a href=${`#/events/${id}/bookings`} className=${section === 'bookings' ? 'active' : ''}>Bookings</a>` : null}
  </nav>`;
}

function BookingsReport({ event }) {
  const [state, setState] = useState({ loading: true, error: null, bookings: [], summaryAt: event.summary_sent_at });
  const load = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }));
    api(`/events/${event.id}/bookings`)
      .then((data) => setState({
        loading: false,
        error: null,
        bookings: data.bookings || [],
        summaryAt: data.event?.summary_sent_at || null,
      }))
      .catch((error) => setState({ loading: false, error, bookings: [], summaryAt: null }));
  }, [event.id]);
  useEffect(() => { load(); }, [load]);

  return html`<div>
    <${LockRow} cutoff=${event.cutoff_at} />
    ${state.summaryAt ? html`<p className="muted section-gap">Summary emailed ${formatWhen(state.summaryAt)}.</p>` : null}
    ${!state.summaryAt && cutoffPassed(event.cutoff_at) ? html`<p className="muted section-gap">The summary email runs on the server after cutoff. It has not been sent yet.</p>` : null}
    ${state.loading ? html`<p className="muted section-gap">Loading bookings…</p>` : null}
    ${state.error ? html`<div className="stack section-gap">
      <div className="note">${state.error.message}</div>
      <button type="button" className="btn btn-primary" onClick=${load}>Try again</button>
    </div>` : null}
    ${!state.loading && !state.error && state.bookings.length === 0 ? html`<div className="card section-gap"><p>No bookings yet.</p></div>` : null}
    ${!state.loading && !state.error ? html`<div className="stack section-gap">
      ${state.bookings.map((booking) => html`<article className="card" key=${booking.id}>
        <div className="data-row"><div className="data-label">Time</div><div className="data-value">${formatWhen(booking.start_time)}–${formatClock(booking.end_time)}</div></div>
        <div className="data-row"><div className="data-label">Student</div><div className="data-value">${booking.student_name}${booking.student_nickname ? ` (${booking.student_nickname})` : ''}${booking.student_grade ? `, grade ${booking.student_grade}` : ''}</div></div>
        <div className="data-row"><div className="data-label">Parent</div><div className="data-value">${[booking.parent_first_name, booking.parent_last_name].filter(Boolean).join(' ') || booking.parent_email}${booking.parent_email && (booking.parent_first_name || booking.parent_last_name) ? ` · ${booking.parent_email}` : ''}</div></div>
        <div className="data-row"><div className="data-label">Relationship</div><div className="data-value">${relationshipLabel(booking)}</div></div>
        <div className="data-row"><div className="data-label">Teacher</div><div className="data-value">${booking.display_name}</div></div>
        <div className="data-row"><div className="data-label">Service</div><div className="data-value">${booking.service_name}</div></div>
        <div className="data-row"><div className="data-label">Room</div><div className="data-value">${booking.location}</div></div>
        <div className="data-row"><div className="data-label">Status</div><div className="data-value">${booking.needs_attention ? html`<span className="pill attention">Needs attention</span>` : html`<span className="pill">${booking.status === 'cancelled' ? 'Cancelled' : 'Confirmed'}</span>`}</div></div>
        ${booking.needs_attention && booking.conflict_reason ? html`<div className="data-row"><div className="data-label">Reason</div><div className="data-value">${booking.conflict_reason}</div></div>` : null}
      </article>`)}
    </div>` : null}
  </div>`;
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
      <${Subnav} id=${state.event.id} section=${section} user=${user} />
      <${AccessNote} user=${user} />
      ${section === 'details' ? html`<${DetailsPanel} event=${state.event} user=${user} timeZone=${timeZone} onSaved=${reload} />` : null}
      ${section === 'services' ? html`<${ServicesPanel} event=${state.event} user=${user} onChange=${reload} />` : null}
      ${section === 'availability' ? html`<${AvailabilityPanel} event=${state.event} user=${user} timeZone=${timeZone} />` : null}
      ${section === 'custom-fields' ? html`<${CustomFieldsPanel} event=${state.event} user=${user} />` : null}
      ${section === 'bookings' ? html`<${BookingsReport} event=${state.event} />` : null}
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

function serviceRoomText(member, staffDirectory) {
  const room = staffDirectory.find((item) => item.id === member.id)?.powerschool_room;
  if (member.room_override) return `Room ${member.room_override} for this service`;
  if (room) return `PowerSchool room ${room}`;
  return 'PowerSchool room not set';
}

function serviceForSchool(services, schoolId) {
  if (schoolId == null) return null;
  const matches = services.filter((service) => service.school_id === schoolId);
  return matches.find((service) => service.active) || matches[0] || null;
}

function ServicesPanel({ event, user, onChange }) {
  const canWrite = user.role === 'it_admin';
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState('');
  const [duration, setDuration] = useState('15');
  const [buffer, setBuffer] = useState('0');
  const [fields, setFields] = useState({});
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [directory, setDirectory] = useState(null);
  const [schools, setSchools] = useState(null);
  const [schoolsWarning, setSchoolsWarning] = useState('');
  const [schoolsSource, setSchoolsSource] = useState('');

  useEffect(() => {
    let live = true;
    api('/staff')
      .then((data) => { if (live) setDirectory(data.staff || []); })
      .catch(() => { if (live) setDirectory([]); });
    api('/schools')
      .then((data) => {
        if (!live) return;
        setSchools(data.schools || []);
        setSchoolsWarning(data.warning || '');
        setSchoolsSource(data.source || '');
      })
      .catch((error) => {
        if (!live) return;
        setSchools([]);
        setSchoolsWarning(error.message);
        setSchoolsSource('');
      });
    return () => { live = false; };
  }, [event.id]);

  function beginEdit(service) {
    setEditingId(service.id);
    setName(service.name);
    setDuration(String(service.slot_duration_minutes));
    setBuffer(String(service.buffer_minutes ?? 0));
    setFields({});
    setFormError('');
    setSuccess('');
  }

  function beginLegacyEdit(service) {
    setEditingId(service.id);
    setName(service.name);
    setDuration(String(service.slot_duration_minutes));
    setFields({});
    setFormError('');
    setSuccess('');
  }

  async function reloadSchools() {
    const data = await api('/schools');
    setSchools(data.schools || []);
    setSchoolsWarning(data.warning || '');
    setSchoolsSource(data.source || '');
    return data.schools || [];
  }

  async function syncSchools() {
    setBusy(true);
    setFormError('');
    setSuccess('');
    try {
      const data = await api('/schools/sync', { method: 'POST', body: {} });
      setSchools(data.schools || []);
      setSchoolsWarning('');
      setSchoolsSource(data.source || '');
      const place = data.source === 'mock' ? 'the PowerSchool stand-in' : 'PowerSchool';
      setSuccess(`Synced ${data.created + data.updated + data.unchanged} schools from ${place}.`);
    } catch (error) {
      setFormError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function ensureSchoolId(school) {
    if (school.id != null) return school.id;
    const data = await api('/schools/sync', { method: 'POST', body: {} });
    setSchools(data.schools || []);
    setSchoolsWarning('');
    setSchoolsSource(data.source || '');
    const matched = (data.schools || []).find(
      (item) => item.powerschool_school_id === school.powerschool_school_id,
    );
    if (!matched?.id) {
      throw new Error('That school could not be synced. Try Sync schools again.');
    }
    return matched.id;
  }

  async function saveSchoolService(formEvent) {
    formEvent.preventDefault();
    if (!editingId) return;
    setBusy(true);
    setFormError('');
    setFields({});
    const payload = {
      name,
      slot_duration_minutes: Number(duration),
      buffer_minutes: Number(buffer),
    };
    try {
      await api(`/services/${editingId}`, { method: 'PATCH', body: payload });
      setSuccess('Service saved.');
      setEditingId(null);
      onChange();
    } catch (error) {
      const mapped = fieldMap(error);
      setFields(mapped);
      setFormError(Object.keys(mapped).length ? '' : error.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveLegacyService(formEvent) {
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

  async function toggleSchool(school, nextOn) {
    if (!canWrite || busy) return;
    setBusy(true);
    setFormError('');
    setSuccess('');
    try {
      const schoolId = nextOn ? await ensureSchoolId(school) : school.id;
      const service = serviceForSchool(event.services, schoolId ?? school.id);
      if (nextOn) {
        if (!service) {
          await api(`/events/${event.id}/services`, {
            method: 'POST',
            body: {
              name: `${school.name} Conference`,
              slot_duration_minutes: 15,
              school_id: schoolId,
            },
          });
          setSuccess(`${school.name} is on.`);
        } else if (!service.active) {
          await api(`/services/${service.id}`, { method: 'PATCH', body: { active: true } });
          setSuccess(`${school.name} is on.`);
        }
      } else if (service) {
        await api(`/services/${service.id}`, { method: 'PATCH', body: { active: false } });
        setSuccess(`${school.name} is off.`);
        if (editingId === service.id) setEditingId(null);
      }
      if (school.id == null && nextOn) await reloadSchools();
      onChange();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleTeacher(service, member, nextOn) {
    if (!canWrite || !member.id || busy) return;
    if (nextOn) await assign(service.id, member.id);
    else await unassign(service.id, member.id);
  }

  const staffDirectory = directory || [];
  const synced = staffDirectory.filter((member) => member.id && member.active);
  const schoolList = schools || [];
  const legacyServices = event.services.filter((service) => service.school_id == null);

  return html`<div className="stack">
    <div className="screen-head school-panel-head">
      <div>
        <p className="lede">Turn on a school to offer conferences there. Teachers match by PowerSchool school.</p>
      </div>
      ${canWrite ? html`<button type="button" className="btn btn-primary" disabled=${busy} onClick=${syncSchools}>${busy ? 'Syncing…' : 'Sync schools'}</button>` : null}
    </div>
    ${success ? html`<div><span className="success-note">${success}</span></div>` : null}
    ${formError ? html`<div className="note">${formError}</div>` : null}
    ${schoolsWarning ? html`<div className="note">${schoolsWarning}</div>` : null}
    ${schoolsSource === 'mock' ? html`<p className="muted">Showing the PowerSchool stand-in. Set PSAPI credentials to sync the live school list.</p>` : null}
    ${schools === null || directory === null ? html`<p className="muted">Loading schools…</p>` : null}
    ${schools !== null && schoolList.length === 0 ? html`<div className="card">
      <p>No schools on file.</p>
      <p className="lede">${canWrite ? 'Sync schools from PowerSchool to turn conferences on by school.' : 'Ask an IT admin to sync schools from PowerSchool.'}</p>
    </div>` : null}
    ${schoolList.map((school) => {
      const service = serviceForSchool(event.services, school.id);
      const isOn = Boolean(service && service.active);
      const schoolStaff = staffDirectory.filter(
        (member) => String(member.powerschool_school_id || '') === String(school.powerschool_school_id || ''),
      );
      const assignedById = new Map((service?.staff || []).map((member) => [member.id, member]));
      return html`<article className="card school-service" key=${school.powerschool_school_id || school.id}>
        <div className="switch-row">
          <div>
            <div className="person-name">${school.name}</div>
            ${!school.id ? html`<div className="muted">Not synced yet</div>` : null}
          </div>
          ${canWrite ? html`<button
            type="button"
            className=${cx('toggle', isOn && 'on')}
            role="switch"
            aria-checked=${isOn ? 'true' : 'false'}
            aria-label=${`${school.name} conferences`}
            disabled=${busy}
            onClick=${() => toggleSchool(school, !isOn)}
          ><span className="toggle-knob"></span></button>` : html`<span className="pill">${isOn ? 'On' : 'Off'}</span>`}
        </div>
        ${isOn && service ? html`<div className="school-service-body">
          ${editingId === service.id ? html`<form className="form section-gap" onSubmit=${saveSchoolService}>
            <label className="field">
              <span className="field-label">Name</span>
              <input className="input" required value=${name} onInput=${(event) => setName(event.target.value)} />
              ${fields.name ? html`<span className="field-error">${fields.name}</span>` : null}
            </label>
            <label className="field">
              <span className="field-label">Slot length (minutes)</span>
              <input className="input" inputMode="numeric" required value=${duration} onInput=${(event) => setDuration(event.target.value)} />
              ${fields.slot_duration_minutes ? html`<span className="field-error">${fields.slot_duration_minutes}</span>` : null}
            </label>
            <label className="field">
              <span className="field-label">Travel time (minutes)</span>
              <input className="input" inputMode="numeric" required value=${buffer} onInput=${(event) => setBuffer(event.target.value)} />
              <span className="field-hint">Gap between the end of one slot and the start of the next.</span>
              ${fields.buffer_minutes ? html`<span className="field-error">${fields.buffer_minutes}</span>` : null}
            </label>
            <div className="btn-row">
              <button className="btn btn-primary" type="submit" disabled=${busy}>Save service</button>
              <button className="btn btn-secondary" type="button" onClick=${() => setEditingId(null)}>Cancel</button>
            </div>
          </form>` : html`<div className="section-gap">
            <h2>${service.name}</h2>
            <p className="event-meta">${service.slot_duration_minutes} minutes · Travel time ${service.buffer_minutes ?? 0} minutes</p>
            ${canWrite ? html`<div className="btn-row">
              <button type="button" className="btn btn-secondary" onClick=${() => beginEdit(service)}>Edit</button>
            </div>` : null}
          </div>`}
          <div className="section-gap">
            <div className="field-label">Teachers</div>
            ${schoolStaff.length === 0 ? html`<p className="muted">No teachers for this school in the directory.</p>` : schoolStaff.map((member) => {
              const assignment = member.id ? assignedById.get(member.id) : null;
              const assigned = Boolean(assignment);
              const room = assignment
                ? serviceRoomText(assignment, staffDirectory)
                : member.powerschool_room
                  ? `PowerSchool room ${member.powerschool_room}`
                  : 'PowerSchool room not set';
              return html`<div className="staff-line" key=${member.id || member.powerschool_teacher_id}>
                <div>
                  <div className="person-name">${member.display_name}${member.active === false ? ' (inactive)' : ''}${!member.id ? ' (not synced)' : ''}</div>
                  <div className="muted">${member.email} · ${room}</div>
                </div>
                ${canWrite && member.id ? html`<button
                  type="button"
                  className=${cx('toggle', assigned && 'on')}
                  role="switch"
                  aria-checked=${assigned ? 'true' : 'false'}
                  aria-label=${`Assign ${member.display_name}`}
                  disabled=${busy || (!assigned && member.active === false)}
                  onClick=${() => toggleTeacher(service, member, !assigned)}
                ><span className="toggle-knob"></span></button>` : assigned ? html`<span className="pill">Assigned</span>` : null}
              </div>`;
            })}
          </div>
        </div>` : null}
      </article>`;
    })}
    <section className="legacy-services stack">
      <h2 className="legacy-services-title">Other</h2>
      <p className="lede">Services not tied to a school. Same tools as before.</p>
      ${canWrite && !editingId ? html`<form className="card form" onSubmit=${saveLegacyService}>
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
      ${legacyServices.length === 0 ? html`<div className="card"><p>No services yet.</p><p className="lede">A service is a bookable offering, such as elementary conferences, with one slot length.</p></div>` : null}
      ${legacyServices.map((service) => html`<article className="card" key=${service.id}>
        ${editingId === service.id ? html`<form className="form" onSubmit=${saveLegacyService}>
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
              const roomText = serviceRoomText(member, staffDirectory);
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
            <button type="button" className="btn btn-secondary" onClick=${() => beginLegacyEdit(service)}>Edit</button>
            <${DeleteControl} label="Delete this service?" busy=${busy} onConfirm=${() => removeService(service.id)} />
          </div>` : null}
        </div>`}
      </article>`)}
      ${canWrite && directory && synced.length === 0 ? html`<p className="muted">Sync teachers on the Staff screen before assigning them.</p>` : null}
    </section>
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

const CUSTOM_FIELD_LABEL_MAX = 200;

function CustomFieldsPanel({ event, user }) {
  const canWrite = user.role === 'it_admin';
  const canRead = user.role === 'it_admin' || user.role === 'front_office';
  const [state, setState] = useState({ loading: true, error: null, fields: [] });
  const [label, setLabel] = useState('');
  const [required, setRequired] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [editRequired, setEditRequired] = useState(false);
  const [fields, setFields] = useState({});
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!canRead) return;
    setState((current) => ({ ...current, loading: true, error: null }));
    api(`/events/${event.id}/custom-fields`)
      .then((data) => setState({
        loading: false,
        error: null,
        fields: data.custom_fields || [],
      }))
      .catch((error) => setState({ loading: false, error, fields: [] }));
  }, [event.id, canRead]);

  useEffect(() => { load(); }, [load]);

  function beginEdit(field) {
    setEditingId(field.id);
    setEditLabel(field.label);
    setEditRequired(Boolean(field.required));
    setFields({});
    setFormError('');
    setSuccess('');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditLabel('');
    setEditRequired(false);
    setFields({});
  }

  async function addField(formEvent) {
    formEvent.preventDefault();
    if (!canWrite) return;
    setBusy(true);
    setFormError('');
    setFields({});
    setSuccess('');
    try {
      await api(`/events/${event.id}/custom-fields`, {
        method: 'POST',
        body: { label: label.trim(), required },
      });
      setLabel('');
      setRequired(false);
      setSuccess('Field added.');
      load();
    } catch (error) {
      const mapped = fieldMap(error);
      setFields(mapped);
      setFormError(Object.keys(mapped).length ? '' : error.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(formEvent) {
    formEvent.preventDefault();
    if (!canWrite || !editingId) return;
    setBusy(true);
    setFormError('');
    setFields({});
    setSuccess('');
    try {
      await api(`/events/${event.id}/custom-fields/${editingId}`, {
        method: 'PATCH',
        body: { label: editLabel.trim(), required: editRequired },
      });
      cancelEdit();
      setSuccess('Field saved.');
      load();
    } catch (error) {
      const mapped = fieldMap(error);
      setFields(mapped);
      setFormError(Object.keys(mapped).length ? '' : error.message);
    } finally {
      setBusy(false);
    }
  }

  async function moveField(index, direction) {
    if (!canWrite) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= state.fields.length) return;
    const ordered = state.fields.map((field) => field.id);
    const swap = ordered[index];
    ordered[index] = ordered[nextIndex];
    ordered[nextIndex] = swap;
    setBusy(true);
    setFormError('');
    setSuccess('');
    try {
      await api(`/events/${event.id}/custom-fields/reorder`, {
        method: 'PATCH',
        body: { ordered_ids: ordered },
      });
      load();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeField(fieldId) {
    if (!canWrite) return;
    setBusy(true);
    setFormError('');
    setSuccess('');
    try {
      await api(`/events/${event.id}/custom-fields/${fieldId}`, { method: 'DELETE' });
      if (editingId === fieldId) cancelEdit();
      setSuccess('Field deleted.');
      load();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setBusy(false);
    }
  }

  if (!canRead) {
    return html`<div className="note">You do not have access to this action.</div>`;
  }

  return html`<div className="stack">
    ${success ? html`<div><span className="success-note">${success}</span></div>` : null}
    ${formError ? html`<div className="note">${formError}</div>` : null}
    ${canWrite && !editingId ? html`<form className="card form" onSubmit=${addField}>
      <h2>Add a custom field</h2>
      <p className="lede">Parents answer these once when they confirm a visit.</p>
      <label className="field">
        <span className="field-label">Label</span>
        <input className="input" required maxLength=${CUSTOM_FIELD_LABEL_MAX} value=${label} onInput=${(event) => setLabel(event.target.value)} />
        ${fields.label ? html`<span className="field-error">${fields.label}</span>` : null}
      </label>
      <div className="switch-row">
        <div>
          <div className="field-label">Required</div>
          <div className="field-hint">Parents must answer before confirming.</div>
        </div>
        <button type="button" className=${cx('toggle', required && 'on')} role="switch" aria-checked=${required ? 'true' : 'false'} aria-label="Required" onClick=${() => setRequired((value) => !value)}>
          <span className="toggle-knob"></span>
        </button>
      </div>
      <button className="btn btn-primary" type="submit" disabled=${busy}>${busy ? 'Adding…' : 'Add field'}</button>
    </form>` : null}
    ${state.loading ? html`<p className="muted">Loading custom fields…</p>` : null}
    ${state.error ? html`<div className="stack">
      <div className="note">${state.error.message}</div>
      <button type="button" className="btn btn-primary" onClick=${load}>Try again</button>
    </div>` : null}
    ${!state.loading && !state.error && state.fields.length === 0 ? html`<div className="card">
      <p>No custom fields yet.</p>
      <p className="lede">Add a question such as preferred language or parking note.</p>
    </div>` : null}
    ${!state.loading && !state.error ? state.fields.map((field, index) => html`<article className="card" key=${field.id}>
      ${editingId === field.id ? html`<form className="form" onSubmit=${saveEdit}>
        <label className="field">
          <span className="field-label">Label</span>
          <input className="input" required maxLength=${CUSTOM_FIELD_LABEL_MAX} value=${editLabel} onInput=${(event) => setEditLabel(event.target.value)} />
          ${fields.label ? html`<span className="field-error">${fields.label}</span>` : null}
        </label>
        <div className="switch-row">
          <div>
            <div className="field-label">Required</div>
          </div>
          <button type="button" className=${cx('toggle', editRequired && 'on')} role="switch" aria-checked=${editRequired ? 'true' : 'false'} aria-label="Required" onClick=${() => setEditRequired((value) => !value)}>
            <span className="toggle-knob"></span>
          </button>
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" type="submit" disabled=${busy}>Save field</button>
          <button className="btn btn-secondary" type="button" onClick=${cancelEdit}>Cancel</button>
        </div>
      </form>` : html`<div>
        <div className="staff-line">
          <div>
            <div className="person-name">${field.label}</div>
            <div className="muted">Position ${index + 1}</div>
          </div>
          ${field.required ? html`<span className="pill">Required</span>` : html`<span className="pill">Optional</span>`}
        </div>
        ${canWrite ? html`<div className="btn-row section-gap">
          <button type="button" className="btn btn-secondary" disabled=${busy || index === 0} onClick=${() => moveField(index, -1)}>Up</button>
          <button type="button" className="btn btn-secondary" disabled=${busy || index >= state.fields.length - 1} onClick=${() => moveField(index, 1)}>Down</button>
          <button type="button" className="btn btn-secondary" onClick=${() => beginEdit(field)}>Edit</button>
          <${DeleteControl}
            label="Delete this field? Past booking answers for this field will also be removed."
            busy=${busy}
            onConfirm=${() => removeField(field.id)}
          />
        </div>` : null}
      </div>`}
    </article>`) : null}
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

function addOneDay(iso) {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function formatNaive(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function durationStamp(minutes) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`;
}

function snapFor(services) {
  if (services.length === 1 && Number.isInteger(services[0].slot_duration_minutes) && services[0].slot_duration_minutes > 0) {
    return durationStamp(services[0].slot_duration_minutes);
  }
  return '00:15:00';
}

function relationshipLabel(booking) {
  if (booking.parent_relationship === 'other') return booking.parent_relationship_other || 'Other';
  const labels = { mother: 'Mother', father: 'Father', guardian: 'Guardian' };
  return labels[booking.parent_relationship] || 'Not set';
}

function QuietLock({ message }) {
  if (!message) return null;
  return html`<div className="lock-row">${html`<${IconLock} />`}<span>${message}</span></div>`;
}

function AgendaCalendar({ schedule, locked, onSelectRange, onPick, onChanged, onDropError }) {
  const host = useRef(null);
  const handlers = useRef({});
  handlers.current = { onSelectRange, onPick, onChanged, onDropError };

  useEffect(() => {
    if (!host.current || typeof FullCalendar === 'undefined') return undefined;
    const snap = snapFor(schedule.services || []);
    const events = [];
    for (const block of schedule.blocks || []) {
      const isBreak = block.block_type === 'break';
      events.push({
        id: `block-${block.id}`,
        title: isBreak ? 'Break' : 'Bookable',
        start: block.start_time.slice(0, 19),
        end: block.end_time.slice(0, 19),
        classNames: [isBreak ? 'fc-break' : 'fc-bookable'],
        startEditable: !locked,
        durationEditable: !locked,
        extendedProps: { kind: block.block_type, block },
      });
    }
    for (const booking of schedule.bookings || []) {
      const nickname = booking.student_nickname ? ` (${booking.student_nickname})` : '';
      events.push({
        id: `booking-${booking.id}`,
        title: `${booking.student_name}${nickname}`,
        start: booking.start_time.slice(0, 19),
        end: booking.end_time.slice(0, 19),
        classNames: ['fc-booking'],
        startEditable: !locked,
        durationEditable: false,
        extendedProps: { kind: 'booking', booking },
      });
    }
    const date = schedule.event.event_date;
    const calendar = new FullCalendar.Calendar(host.current, {
      initialView: 'timeGridDay',
      initialDate: date,
      validRange: { start: date, end: addOneDay(date) },
      headerToolbar: false,
      allDaySlot: false,
      height: 'auto',
      expandRows: true,
      slotMinTime: '07:00:00',
      slotMaxTime: '18:00:00',
      slotDuration: snap,
      snapDuration: snap,
      slotLabelInterval: '01:00:00',
      slotLabelFormat: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
      eventTimeFormat: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
      editable: !locked,
      selectable: !locked,
      selectMirror: true,
      unselectAuto: true,
      unselectCancel: '.agenda-side',
      nowIndicator: true,
      eventOverlap: true,
      events,
      select(info) {
        handlers.current.onSelectRange({
          start: formatNaive(info.start),
          end: formatNaive(info.end),
        });
      },
      eventClick(info) {
        handlers.current.onPick(info.event.extendedProps);
      },
      eventDrop(info) { persist(info); },
      eventResize(info) { persist(info); },
    });
    calendar.render();

    async function persist(info) {
      const props = info.event.extendedProps;
      const body = {
        start_time: formatNaive(info.event.start),
        end_time: formatNaive(info.event.end),
      };
      const path = props.kind === 'booking'
        ? `/bookings/${props.booking.id}/reschedule`
        : `/availability/${props.block.id}`;
      try {
        await api(path, { method: 'PATCH', body });
        handlers.current.onChanged();
      } catch (error) {
        info.revert();
        handlers.current.onDropError(error);
      }
    }

    return () => calendar.destroy();
  }, [schedule, locked]);

  return html`<div className=${cx('agenda-calendar', locked && 'is-locked')} ref=${host}></div>`;
}

function AgendaScreen({ user, eventId, timeZone }) {
  const id = positiveId(eventId);
  const [list, setList] = useState({ loading: true, error: null, events: [] });
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState('');
  const [selection, setSelection] = useState(null);
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');
  const [notice, setNotice] = useState('');
  const [serverLock, setServerLock] = useState('');

  const loadList = useCallback(() => {
    setList((current) => ({ ...current, loading: true, error: null }));
    api('/events')
      .then((data) => setList({ loading: false, error: null, events: data.events || [] }))
      .catch((err) => setList({ loading: false, error: err, events: [] }));
  }, []);

  const loadSchedule = useCallback(() => {
    if (!id) return Promise.resolve();
    setError('');
    return api(`/events/${id}/my-schedule`)
      .then((data) => {
        setSchedule(data);
        setLoading(false);
      })
      .catch((err) => {
        setSchedule(null);
        setError(err.message);
        setLoading(false);
      });
  }, [id]);

  useEffect(() => {
    if (user.role !== 'teacher' || id) return undefined;
    loadList();
    return undefined;
  }, [user.role, id, loadList]);

  useEffect(() => {
    if (user.role !== 'teacher' || !id) return undefined;
    setSchedule(null);
    setLoading(true);
    setSelection(null);
    setPick(null);
    setServerLock('');
    setSuccess('');
    setNotice('');
    loadSchedule();
    return undefined;
  }, [user.role, id, loadSchedule]);

  if (user.role !== 'teacher') {
    return html`<${Shell} user=${user} active="agenda">
      <h1>Agenda</h1>
      <p className="lede">The agenda is for teachers.</p>
      <p className="section-gap"><a className="back" href="#/events">Conferences</a></p>
    </${Shell}>`;
  }

  if (!id) {
    const focusId = attentionEventId(list.events);
    return html`<${Shell} user=${user} active="agenda">
      <div className="screen-head">
        <div>
          <h1>Agenda</h1>
          <p className="lede">Open a conference day to move meetings and block breaks.</p>
        </div>
        ${list.error ? html`<button type="button" className="btn btn-primary" onClick=${loadList}>Try again</button>` : null}
      </div>
      <div className="stack">
        ${list.loading ? html`<p className="muted">Loading conferences…</p>` : null}
        ${list.error ? html`<div className="note">${list.error.message}</div>` : null}
        ${!list.loading && !list.error && list.events.length === 0 ? html`<div className="card"><p>No conferences yet.</p></div>` : null}
        ${!list.loading && !list.error ? html`<div className="list">
          ${list.events.map((event) => html`<a className="card event-card" href=${`#/agenda/${event.id}`} key=${event.id}>
            <span className="icon-badge" aria-hidden="true"><${IconAgenda} /></span>
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

  const lockedMessage = serverLock || (schedule && cutoffPassed(schedule.event.cutoff_at) ? cutoffMessage(schedule.event.cutoff_at, timeZone) : '');
  const locked = Boolean(lockedMessage);

  async function blockTime() {
    if (!selection || locked || !schedule) return;
    setBusy(true);
    setNotice('');
    setSuccess('');
    try {
      await api(`/events/${schedule.event.id}/staff/${schedule.staff.id}/availability`, {
        method: 'POST',
        body: { start_time: selection.start, end_time: selection.end, block_type: 'break' },
      });
      setSelection(null);
      setPick(null);
      setSuccess('Break saved.');
      await loadSchedule();
    } catch (err) {
      if (err.status === 423) setServerLock(err.message);
      else setNotice(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeBlock() {
    if (!pick?.block || locked) return;
    setBusy(true);
    setNotice('');
    setSuccess('');
    try {
      await api(`/availability/${pick.block.id}`, { method: 'DELETE' });
      setPick(null);
      setSuccess('Block removed.');
      await loadSchedule();
    } catch (err) {
      if (err.status === 423) setServerLock(err.message);
      else setNotice(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelBooking() {
    if (!pick?.booking || locked) return;
    setBusy(true);
    setNotice('');
    setSuccess('');
    try {
      await api(`/bookings/${pick.booking.id}`, { method: 'DELETE' });
      setPick(null);
      setSuccess('Booking cancelled.');
      await loadSchedule();
    } catch (err) {
      if (err.status === 423) setServerLock(err.message);
      else setNotice(err.message);
    } finally {
      setBusy(false);
    }
  }

  function onDropError(err) {
    setSuccess('');
    if (err.status === 423) {
      setNotice('');
      setServerLock(err.message);
      return;
    }
    setNotice(err.message);
  }

  return html`<${Shell} user=${user} active="agenda">
    <a className="back" href="#/agenda">Agenda</a>
    ${loading ? html`<p className="muted section-gap">Loading your day…</p>` : null}
    ${error ? html`<div className="note section-gap">${error}</div>` : null}
    ${schedule ? html`<div className="section-gap">
      <div className="screen-head">
        <div>
          <h1>${schedule.event.name}</h1>
          <p className="lede">${formatDate(schedule.event.event_date)} · ${schedule.staff.display_name}</p>
        </div>
      </div>
      ${locked ? html`<div className="section-gap"><${QuietLock} message=${lockedMessage} /></div>` : null}
      ${success ? html`<div className="section-gap"><span className="success-note">${success}</span></div>` : null}
      ${notice ? html`<p className="muted section-gap">${notice}</p>` : null}
      <div className="agenda-layout section-gap">
        <${AgendaCalendar}
          schedule=${schedule}
          locked=${locked}
          onSelectRange=${setSelection}
          onPick=${(next) => { setPick(next); setNotice(''); }}
          onChanged=${() => { setSuccess('Time updated.'); loadSchedule(); }}
          onDropError=${onDropError}
        />
        <aside className="agenda-side card">
          <h2>This day</h2>
          <p className="lede">Drag a meeting onto an open slot. Select a range, then block it for a break.</p>
          <p className="field-hint">${selection && !locked ? `${formatClock(selection.start)}–${formatClock(selection.end)} selected` : 'Select a range on the day to block a break.'}</p>
          <button className="btn btn-primary" type="button" disabled=${busy || locked || !selection} onClick=${blockTime}>${busy ? 'Saving…' : 'Block time'}</button>
          ${pick?.kind === 'booking' ? html`<div className="confirm">
            <div className="data-row"><div className="data-label">Student</div><div className="data-value">${pick.booking.student_name}${pick.booking.student_nickname ? ` (${pick.booking.student_nickname})` : ''}</div></div>
            <div className="data-row"><div className="data-label">Grade</div><div className="data-value">${pick.booking.student_grade || 'Not set'}</div></div>
            <div className="data-row"><div className="data-label">Adult</div><div className="data-value">${relationshipLabel(pick.booking)}</div></div>
            <div className="data-row"><div className="data-label">Service</div><div className="data-value">${pick.booking.service_name}</div></div>
            <div className="data-row"><div className="data-label">Time</div><div className="data-value">${formatClock(pick.booking.start_time)}–${formatClock(pick.booking.end_time)}</div></div>
            <button type="button" className="text-button" disabled=${busy || locked} onClick=${cancelBooking}>Cancel this time</button>
          </div>` : null}
          ${pick?.block ? html`<div className="confirm">
            <div className="data-row"><div className="data-label">Block</div><div className="data-value">${pick.kind === 'break' ? 'Break' : 'Bookable'}</div></div>
            <div className="data-row"><div className="data-label">Time</div><div className="data-value">${formatClock(pick.block.start_time)}–${formatClock(pick.block.end_time)}</div></div>
            <button type="button" className="text-button" disabled=${busy || locked} onClick=${removeBlock}>${pick.kind === 'break' ? 'Remove break' : 'Remove this block'}</button>
          </div>` : null}
        </aside>
      </div>
    </div>` : null}
  </${Shell}>`;
}

const PURPOSE_LABEL = {
  verification_code: 'Verification code',
  booking_confirmation: 'Booking confirmation',
  summary: 'Summary',
  conflict_notification: 'Schedule change',
};

function formatSentAt(sentAt, timeZone) {
  if (!sentAt) return '';
  const iso = sentAt.includes('T') ? sentAt : `${sentAt.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return sentAt;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone || 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function fallbackLabel(contact) {
  if (!contact || contact.fallback_contact_type === 'none' || !contact.fallback_contact_value) {
    return 'None on file';
  }
  const names = { line: 'LINE', phone: 'Phone', wechat: 'WeChat' };
  const name = names[contact.fallback_contact_type] || contact.fallback_contact_type;
  return `${name} ${contact.fallback_contact_value}`;
}

function IssueStatus({ issue }) {
  if (issue.status === 'bounced' || issue.status === 'complained') {
    const label = issue.status === 'bounced' ? 'Bounced' : 'Complained';
    return html`<span className="pill attention">${label}</span>`;
  }
  return html`<span className="pill">Unconfirmed</span>`;
}

function NotificationIssuesScreen({ user, timeZone }) {
  const [state, setState] = useState({ loading: true, error: null, issues: [] });

  const load = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }));
    api('/admin/notifications/delivery-issues')
      .then((data) => setState({ loading: false, error: null, issues: data.issues || [] }))
      .catch((error) => setState({ loading: false, error, issues: [] }));
  }, []);

  useEffect(() => { load(); }, [load]);

  return html`<${Shell} user=${user} active="notifications">
    <div className="screen-head">
      <div>
        <h1>Notification issues</h1>
        <p className="lede">Emails that bounced, were marked as spam, or were never confirmed as delivered.</p>
      </div>
      ${state.error ? html`<button type="button" className="btn btn-primary" onClick=${load}>Try again</button>` : null}
    </div>
    <div className="stack">
      <p className="muted">${user.role === 'front_office'
        ? 'This list is read-only. Follow up with the family directly.'
        : 'Follow up with the family directly. There is no resend from this screen.'}</p>
      ${state.loading ? html`<p className="muted">Loading notification issues…</p>` : null}
      ${state.error ? html`<div className="note">${state.error.message}</div>` : null}
      ${!state.loading && !state.error && state.issues.length === 0 ? html`<div className="card"><p>No notification issues.</p></div>` : null}
      ${state.issues.map((issue) => html`<article className="card" key=${issue.id}>
        <div className="data-row"><div className="data-label">Recipient</div><div className="data-value">${issue.recipient_email}</div></div>
        <div className="data-row"><div className="data-label">Purpose</div><div className="data-value">${PURPOSE_LABEL[issue.purpose] || issue.purpose}</div></div>
        <div className="data-row"><div className="data-label">Sent</div><div className="data-value">${formatSentAt(issue.sent_at, timeZone)}</div></div>
        <div className="data-row"><div className="data-label">Status</div><div className="data-value"><${IssueStatus} issue=${issue} /></div></div>
        <div className="data-row"><div className="data-label">Fallback contact</div><div className="data-value">${fallbackLabel(issue.fallback_contact)}</div></div>
        ${issue.status_detail ? html`<div className="data-row"><div className="data-label">Detail</div><div className="data-value">${issue.status_detail}</div></div>` : null}
      </article>`)}
    </div>
  </${Shell}>`;
}

const LANDING_BLOCK_LABELS = {
  header: 'Header',
  login_tiles: 'Login tiles',
  announcement: 'Announcement',
  rich_text: 'Rich text',
};

const LANDING_DEFAULT_CONTENT = {
  header: {
    school_name: 'Nakornpayap International School',
    welcome_text: 'Welcome to Parent-Teacher Conferences',
    logo_url: null,
  },
  login_tiles: {
    parent_label: 'Parent / Student',
    parent_description: 'Verify your email to book a conference time.',
    teacher_label: 'Teacher / Staff',
    teacher_description: 'Sign in to manage your schedule.',
  },
  announcement: {
    message: 'Booking details will appear here.',
    tone: 'info',
  },
  rich_text: {
    text: 'Add supporting information here. Use **bold**, *italic*, and [safe links](https://example.com).',
  },
};

function escapeHtmlEntities(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function unescapeHtmlEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseInlineMarkdown(escapedLine, keyPrefix) {
  const nodes = [];
  const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  let lastIndex = 0;
  let match;
  let part = 0;
  while ((match = pattern.exec(escapedLine)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(unescapeHtmlEntities(escapedLine.slice(lastIndex, match.index)));
    }
    const key = `${keyPrefix}-${part++}`;
    if (match[2] !== undefined) {
      nodes.push(html`<strong key=${key}>${unescapeHtmlEntities(match[2])}</strong>`);
    } else if (match[3] !== undefined) {
      nodes.push(html`<em key=${key}>${unescapeHtmlEntities(match[3])}</em>`);
    } else {
      nodes.push(html`<a key=${key} href=${match[5]} target="_blank" rel="noopener noreferrer">${unescapeHtmlEntities(match[4])}</a>`);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < escapedLine.length) {
    nodes.push(unescapeHtmlEntities(escapedLine.slice(lastIndex)));
  }
  return nodes;
}

function renderMarkdownLite(text) {
  const escaped = escapeHtmlEntities(text);
  const lines = escaped.split(/\r?\n/);
  const nodes = [];
  lines.forEach((line, index) => {
    if (index > 0) nodes.push(html`<br key=${`br-${index}`} />`);
    const inline = parseInlineMarkdown(line, `L${index}`);
    if (inline.length === 0) nodes.push('');
    else nodes.push(...inline);
  });
  return nodes;
}

function LandingParentIcon() {
  return html`<svg className="landing-tile-icon" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="9" cy="8" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <path d="M4.4 18.2c.7-2.7 2.5-4.1 4.6-4.1s3.9 1.4 4.6 4.1" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <circle cx="16.4" cy="9.2" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <path d="M15.2 14.1c1.7-.2 3.1.7 3.8 2.8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>`;
}

function LandingStaffIcon() {
  return html`<svg className="landing-tile-icon" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="8" r="2.7" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <path d="M6.2 18.3c.9-3 2.9-4.5 5.8-4.5s4.9 1.5 5.8 4.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="M16.8 6.2 18.6 8l-1.8 1.8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>`;
}

function LandingHeaderBlock({ content }) {
  const logoUrl = content?.logo_url;
  return html`<section className="landing-block landing-hero">
    ${logoUrl ? html`<img className="landing-logo" src=${logoUrl} alt="" />` : null}
    <h1 className="landing-hero-title">${content?.school_name || ''}</h1>
    <p className="landing-hero-sub">${content?.welcome_text || ''}</p>
    <div className="landing-accent-divider" aria-hidden="true">
      <span className="landing-accent-bar landing-accent-bar--primary"></span>
      <span className="landing-accent-bar landing-accent-bar--secondary"></span>
    </div>
  </section>`;
}

function LandingLoginTilesBlock({ content }) {
  return html`<section className="landing-block landing-tiles" aria-label="Sign in options">
    <a className="landing-tile landing-tile--parent" href="#/verify">
      <span className="landing-tile-badge" aria-hidden="true"><${LandingParentIcon} /></span>
      <h2 className="landing-tile-title">${content?.parent_label || 'Parent / Student'}</h2>
      <p className="landing-tile-body">${content?.parent_description || ''}</p>
      <span className="landing-tile-cta">Continue <span className="landing-tile-cta-arrow" aria-hidden="true">→</span></span>
    </a>
    <a className="landing-tile landing-tile--staff" href="#/sign-in">
      <span className="landing-tile-badge" aria-hidden="true"><${LandingStaffIcon} /></span>
      <h2 className="landing-tile-title">${content?.teacher_label || 'Teacher / Staff'}</h2>
      <p className="landing-tile-body">${content?.teacher_description || ''}</p>
      <span className="landing-tile-cta">Continue <span className="landing-tile-cta-arrow" aria-hidden="true">→</span></span>
    </a>
  </section>`;
}

function LandingAnnouncementBlock({ content }) {
  const tone = content?.tone === 'warning' ? 'warning' : 'info';
  return html`<section className=${cx('landing-block', 'landing-announcement', tone)} role="status">
    <p>${content?.message || ''}</p>
  </section>`;
}

function LandingRichTextBlock({ content }) {
  return html`<section className="landing-block landing-rich-text">
    <p>${renderMarkdownLite(content?.text || '')}</p>
  </section>`;
}

function LandingBlockView({ block }) {
  if (block.block_type === 'header') return html`<${LandingHeaderBlock} content=${block.content} key=${block.id} />`;
  if (block.block_type === 'login_tiles') return html`<${LandingLoginTilesBlock} content=${block.content} key=${block.id} />`;
  if (block.block_type === 'announcement') return html`<${LandingAnnouncementBlock} content=${block.content} key=${block.id} />`;
  if (block.block_type === 'rich_text') return html`<${LandingRichTextBlock} content=${block.content} key=${block.id} />`;
  return null;
}

function PublicLandingScreen() {
  const [state, setState] = useState({ loading: true, error: null, blocks: [] });

  useEffect(() => {
    let live = true;
    api('/landing-page/blocks', { allow401: true })
      .then((data) => {
        if (!live) return;
        setState({ loading: false, error: null, blocks: data.blocks || [] });
      })
      .catch((error) => {
        if (!live) return;
        setState({ loading: false, error, blocks: [] });
      });
    return () => { live = false; };
  }, []);

  return html`<div className="landing-page">
    <header className="landing-topbar">
      <${Logo} href="#/" />
      <p className="landing-topbar-tagline">Parent-Teacher Conferences</p>
    </header>
    <main className="landing-main">
      ${state.loading ? html`<p className="landing-status">Loading…</p>` : null}
      ${state.error ? html`<div className="landing-note">${state.error.message}</div>` : null}
      ${!state.loading && !state.error && state.blocks.length === 0
        ? html`<div className="landing-note">No landing page content is published yet.</div>`
        : null}
      <div className="landing-stack">
        ${state.blocks.map((block) => html`<${LandingBlockView} block=${block} key=${block.id} />`)}
      </div>
    </main>
    <footer className="landing-footer">
      <p>Nakornpayap International School</p>
    </footer>
  </div>`;
}

function cloneLandingContent(blockType, content) {
  const base = LANDING_DEFAULT_CONTENT[blockType] || {};
  return { ...base, ...(content || {}) };
}

function LandingBlockEditorCard({
  block,
  index,
  total,
  busy,
  onToggleVisible,
  onSaveContent,
  onMove,
  onDelete,
}) {
  const [draft, setDraft] = useState(() => cloneLandingContent(block.block_type, block.content));
  const [fields, setFields] = useState({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(cloneLandingContent(block.block_type, block.content));
    setFields({});
    setError('');
    setSuccess('');
  }, [block.id, block.updated_at, block.block_type]);

  function updateField(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSuccess('');
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setFields({});
    setSuccess('');
    try {
      const content = block.block_type === 'header'
        ? {
          school_name: draft.school_name,
          welcome_text: draft.welcome_text,
          logo_url: draft.logo_url && String(draft.logo_url).trim() ? String(draft.logo_url).trim() : null,
        }
        : block.block_type === 'login_tiles'
          ? {
            parent_label: draft.parent_label,
            parent_description: draft.parent_description,
            teacher_label: draft.teacher_label,
            teacher_description: draft.teacher_description,
          }
          : block.block_type === 'announcement'
            ? { message: draft.message, tone: draft.tone === 'warning' ? 'warning' : 'info' }
            : { text: draft.text };
      await onSaveContent(block.id, content);
      setSuccess('Saved');
    } catch (err) {
      setError(err.message);
      setFields(fieldMap(err));
    } finally {
      setSaving(false);
    }
  }

  return html`<article className=${cx('card', 'landing-editor-card', !block.visible && 'is-hidden')}>
    <div className="landing-editor-card-head">
      <div>
        <h2>${LANDING_BLOCK_LABELS[block.block_type] || block.block_type}</h2>
        <p className="muted">Position ${index + 1}</p>
      </div>
      <div className="row-actions">
        <button type="button" className="btn btn-secondary" disabled=${busy || index === 0} onClick=${() => onMove(index, -1)}>Up</button>
        <button type="button" className="btn btn-secondary" disabled=${busy || index >= total - 1} onClick=${() => onMove(index, 1)}>Down</button>
        <div className="switch-row landing-visibility">
          <span className="field-label">${block.visible ? 'Visible' : 'Hidden'}</span>
          <button
            type="button"
            className=${cx('toggle', block.visible && 'on')}
            role="switch"
            aria-checked=${block.visible ? 'true' : 'false'}
            aria-label="Visible on public landing page"
            disabled=${busy}
            onClick=${() => onToggleVisible(block)}
          >
            <span className="toggle-knob"></span>
          </button>
        </div>
      </div>
    </div>
    <form className="form landing-editor-form" onSubmit=${save}>
      ${block.block_type === 'header' ? html`
        <label className="field">
          <span className="field-label">School name</span>
          <input className="input" value=${draft.school_name || ''} onInput=${(event) => updateField('school_name', event.target.value)} />
          ${fields.school_name ? html`<span className="field-error">${fields.school_name}</span>` : null}
        </label>
        <label className="field">
          <span className="field-label">Welcome text</span>
          <textarea className="input" rows="3" value=${draft.welcome_text || ''} onInput=${(event) => updateField('welcome_text', event.target.value)}></textarea>
          ${fields.welcome_text ? html`<span className="field-error">${fields.welcome_text}</span>` : null}
        </label>
        <label className="field">
          <span className="field-label">Logo URL (optional)</span>
          <input className="input" value=${draft.logo_url || ''} placeholder="https://" onInput=${(event) => updateField('logo_url', event.target.value)} />
          ${fields.logo_url ? html`<span className="field-error">${fields.logo_url}</span>` : null}
        </label>
      ` : null}
      ${block.block_type === 'login_tiles' ? html`
        <label className="field">
          <span className="field-label">Parent / student label</span>
          <input className="input" value=${draft.parent_label || ''} onInput=${(event) => updateField('parent_label', event.target.value)} />
          ${fields.parent_label ? html`<span className="field-error">${fields.parent_label}</span>` : null}
        </label>
        <label className="field">
          <span className="field-label">Parent / student description</span>
          <textarea className="input" rows="2" value=${draft.parent_description || ''} onInput=${(event) => updateField('parent_description', event.target.value)}></textarea>
          ${fields.parent_description ? html`<span className="field-error">${fields.parent_description}</span>` : null}
        </label>
        <label className="field">
          <span className="field-label">Teacher / staff label</span>
          <input className="input" value=${draft.teacher_label || ''} onInput=${(event) => updateField('teacher_label', event.target.value)} />
          ${fields.teacher_label ? html`<span className="field-error">${fields.teacher_label}</span>` : null}
        </label>
        <label className="field">
          <span className="field-label">Teacher / staff description</span>
          <textarea className="input" rows="2" value=${draft.teacher_description || ''} onInput=${(event) => updateField('teacher_description', event.target.value)}></textarea>
          ${fields.teacher_description ? html`<span className="field-error">${fields.teacher_description}</span>` : null}
        </label>
        <p className="field-hint">Links stay fixed: parents go to Verify email, staff go to Sign in.</p>
      ` : null}
      ${block.block_type === 'announcement' ? html`
        <label className="field">
          <span className="field-label">Message</span>
          <textarea className="input" rows="3" value=${draft.message || ''} onInput=${(event) => updateField('message', event.target.value)}></textarea>
          ${fields.message ? html`<span className="field-error">${fields.message}</span>` : null}
        </label>
        <label className="field">
          <span className="field-label">Tone</span>
          <select className="input" value=${draft.tone === 'warning' ? 'warning' : 'info'} onChange=${(event) => updateField('tone', event.target.value)}>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
          </select>
          ${fields.tone ? html`<span className="field-error">${fields.tone}</span>` : null}
        </label>
      ` : null}
      ${block.block_type === 'rich_text' ? html`
        <label className="field">
          <span className="field-label">Text</span>
          <textarea className="input" rows="6" value=${draft.text || ''} onInput=${(event) => updateField('text', event.target.value)}></textarea>
          ${fields.text ? html`<span className="field-error">${fields.text}</span>` : null}
          <span className="field-hint">Markdown-lite: **bold**, *italic*, line breaks, and http(s) links as [label](https://…).</span>
        </label>
      ` : null}
      ${error ? html`<div className="note">${error}</div>` : null}
      ${success ? html`<span className="success-note">${success}</span>` : null}
      <div className="row-actions">
        <button className="btn btn-primary" type="submit" disabled=${saving || busy}>${saving ? 'Saving…' : 'Save'}</button>
        <${DeleteControl} label="Delete this block?" busy=${busy} onConfirm=${() => onDelete(block.id)} />
      </div>
    </form>
  </article>`;
}

function LandingPageEditorScreen({ user }) {
  const canWrite = user.role === 'it_admin';
  const [state, setState] = useState({ loading: true, error: null, blocks: [] });
  const [addType, setAddType] = useState('announcement');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  async function load() {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await api('/admin/landing-page/blocks');
      setState({ loading: false, error: null, blocks: data.blocks || [] });
    } catch (error) {
      setState({ loading: false, error, blocks: [] });
    }
  }

  useEffect(() => {
    if (!canWrite) return;
    load();
  }, [canWrite]);

  async function addBlock(event) {
    event.preventDefault();
    if (!canWrite) return;
    setBusy(true);
    setFormError('');
    try {
      const blockType = addType;
      await api('/admin/landing-page/blocks', {
        method: 'POST',
        body: {
          block_type: blockType,
          content: cloneLandingContent(blockType),
          visible: true,
        },
      });
      await load();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleVisible(block) {
    setBusy(true);
    setFormError('');
    try {
      await api(`/admin/landing-page/blocks/${block.id}`, {
        method: 'PATCH',
        body: { visible: !block.visible },
      });
      await load();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveContent(id, content) {
    setBusy(true);
    setFormError('');
    try {
      await api(`/admin/landing-page/blocks/${id}`, {
        method: 'PATCH',
        body: { content },
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function moveBlock(index, direction) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= state.blocks.length) return;
    const ordered = state.blocks.map((block) => block.id);
    const swap = ordered[index];
    ordered[index] = ordered[nextIndex];
    ordered[nextIndex] = swap;
    setBusy(true);
    setFormError('');
    try {
      await api('/admin/landing-page/blocks/reorder', {
        method: 'PATCH',
        body: { ordered_ids: ordered },
      });
      await load();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteBlock(id) {
    setBusy(true);
    setFormError('');
    try {
      await api(`/admin/landing-page/blocks/${id}`, { method: 'DELETE' });
      await load();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setBusy(false);
    }
  }

  return html`<${Shell} user=${user} active="landing-page">
    <div className="screen-head">
      <div>
        <h1>Landing page</h1>
        <p className="lede">Edit the public home page parents and staff see before they sign in.</p>
      </div>
      <a className="btn btn-secondary" href="#/">Preview</a>
    </div>
    ${!canWrite ? html`<${AccessNote} user=${user} />` : null}
    ${canWrite ? html`<div className="stack">
      <form className="card form inline-add" onSubmit=${addBlock}>
        <label className="field">
          <span className="field-label">Add block</span>
          <select className="input" value=${addType} onChange=${(event) => setAddType(event.target.value)}>
            <option value="header">Header</option>
            <option value="login_tiles">Login tiles</option>
            <option value="announcement">Announcement</option>
            <option value="rich_text">Rich text</option>
          </select>
        </label>
        <button className="btn btn-primary" type="submit" disabled=${busy}>Add</button>
      </form>
      ${formError ? html`<div className="note">${formError}</div>` : null}
      ${state.loading ? html`<p className="muted">Loading blocks…</p>` : null}
      ${state.error ? html`<div className="note">${state.error.message}</div>` : null}
      ${!state.loading && !state.error && state.blocks.length === 0
        ? html`<div className="card"><p>No blocks yet. Add a header or login tiles to get started.</p></div>`
        : null}
      ${state.blocks.map((block, index) => html`<${LandingBlockEditorCard}
        key=${block.id}
        block=${block}
        index=${index}
        total=${state.blocks.length}
        busy=${busy}
        onToggleVisible=${toggleVisible}
        onSaveContent=${saveContent}
        onMove=${moveBlock}
        onDelete=${deleteBlock}
      />`)}
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
      landing: 'Parent-Teacher Conferences',
      'landing-page': 'Landing page',
      events: 'Conferences',
      'event-new': 'New conference',
      event: 'Conference',
      services: 'Services',
      availability: 'Availability',
      'custom-fields': 'Custom fields',
      bookings: 'Bookings',
      agenda: 'Agenda',
      staff: 'Staff',
      'staff-edit': 'Staff',
      'sign-in': 'Sign in',
      verify: 'Verify your email',
      book: 'Book a conference',
      notifications: 'Notification issues',
    };
    document.title = `${titles[route.name] || 'Conferences'} — Nakornpayap International School`;
  }, [route.name]);

  async function signOut() {
    try { await api('/auth/session', { method: 'DELETE' }); } catch { /* cookie cleared or already gone */ }
    setUser(null);
    window.location.hash = '#/sign-in';
  }

  if (route.name === 'verify') {
    return html`<${VerifyEmailScreen} returnTo=${route.returnTo} initialEmail=${route.email} />`;
  }
  if (route.name === 'book') return html`<${BookingScreen} eventId=${route.id} />`;
  if (route.name === 'landing') return html`<${PublicLandingScreen} />`;

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

  if (route.name === 'landing-page') return html`<${LandingPageEditorScreen} user=${user} />`;
  if (route.name === 'agenda') return html`<${AgendaScreen} user=${user} eventId=${route.id} timeZone=${timeZone} />`;
  if (route.name === 'event-new') return html`<${NewEventScreen} user=${user} />`;
  if (route.name === 'event') return html`<${EventWorkspace} user=${user} eventId=${route.id} section="details" timeZone=${timeZone} />`;
  if (route.name === 'services') return html`<${EventWorkspace} user=${user} eventId=${route.id} section="services" timeZone=${timeZone} />`;
  if (route.name === 'availability') return html`<${EventWorkspace} user=${user} eventId=${route.id} section="availability" timeZone=${timeZone} />`;
  if (route.name === 'custom-fields') return html`<${EventWorkspace} user=${user} eventId=${route.id} section="custom-fields" timeZone=${timeZone} />`;
  if (route.name === 'bookings') return html`<${EventWorkspace} user=${user} eventId=${route.id} section="bookings" timeZone=${timeZone} />`;
  if (route.name === 'notifications') return html`<${NotificationIssuesScreen} user=${user} timeZone=${timeZone} />`;
  if (route.name === 'staff') return html`<${StaffScreen} user=${user} />`;
  if (route.name === 'staff-edit') return html`<${StaffEditScreen} user=${user} staffId=${route.id} />`;
  return html`<${EventsScreen} user=${user} />`;
}

ReactDOM.createRoot(document.getElementById('root')).render(html`<${App} />`);
