import { createApp } from './src/app.js';
import { loadConfig } from './src/config.js';
import { startSummaryJob } from './src/summary-job.js';

const config = loadConfig();
const app = createApp(config);
const server = app.listen(config.port, config.host, () => {
  const where = config.host === '0.0.0.0' ? '127.0.0.1' : config.host;
  console.log(`NIS Parent-Teacher Conferences listening on http://${where}:${config.port}`);
  console.log(config.psapi.baseUrl && config.psapi.clientId && config.psapi.clientSecret
    ? 'PowerSchool: live credentials configured'
    : 'PowerSchool: mock teacher list (credentials are not configured)');
  console.log(config.google.configured
    ? 'Sign-in: Google Workspace'
    : 'Sign-in: local email fallback (Google OAuth is not configured)');
  console.log(config.mail.configured
    ? 'Verification email: SMTP'
    : 'Verification email: codes logged on the server (SMTP is not configured)');
  const every = Number.isFinite(config.summaryIntervalMs) && config.summaryIntervalMs > 0
    ? `then every ${Math.round(config.summaryIntervalMs / 1000)} seconds`
    : 'then not again until the next restart';
  console.log(`Summary email: checked at startup, ${every}`);
});

const stopSummary = startSummaryJob({
  repos: app.locals.repos,
  mail: config.mail,
  psapi: app.locals.psapi,
  timeZone: config.timeZone,
  intervalMs: config.summaryIntervalMs,
});

function shutdown() {
  stopSummary();
  server.close(() => {
    app.locals.db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
