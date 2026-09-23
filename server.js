import { createApp } from './src/app.js';
import { loadConfig } from './src/config.js';

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
});

function shutdown() {
  server.close(() => {
    app.locals.db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
