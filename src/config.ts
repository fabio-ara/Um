export const config = {
  name: 'Um', version: '0.1.0', local: process.env.APP_MODE === 'local',
  port: Number(process.env.PORT || 4417),
  origin: process.env.APP_ORIGIN || 'http://127.0.0.1:4419',
  apiOrigin: process.env.API_ORIGIN || 'http://127.0.0.1:4417',
  authUrl: process.env.AUTH_URL || 'http://127.0.0.1:4418',
  issuer: process.env.AUTH_ISSUER || 'http://127.0.0.1:4417/auth/v1',
  database: process.env.DATABASE_URL,
  storageUrl: process.env.SUPABASE_URL,
  storageKey: process.env.SUPABASE_PUBLISHABLE_KEY,
  bucket: 'um-private',
};
