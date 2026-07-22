// Routing Middleware — runs before every request (static files and /api/*)
// and gates the whole app behind HTTP Basic Auth.
//
// Configure allowed users in the Vercel dashboard as an environment
// variable named APP_USERS, holding a JSON object of username -> password,
// e.g.  {"alice":"correct-horse","bob":"battery-staple"}

import { next } from '@vercel/functions';

export const config = {
  matcher: '/:path*',
};

function parseUsers() {
  try {
    return JSON.parse(process.env.APP_USERS || '{}');
  } catch {
    return {};
  }
}

function unauthorized() {
  return new Response('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Directory Runner"' },
  });
}

export default function middleware(request) {
  const users = parseUsers();

  if (Object.keys(users).length === 0) {
    // No users configured yet — fail closed rather than leaving the app open.
    return new Response(
      'This app has no users configured. Set the APP_USERS environment variable in your Vercel project settings, then redeploy.',
      { status: 503 }
    );
  }

  const auth = request.headers.get('authorization');
  if (auth && auth.startsWith('Basic ')) {
    let decoded = '';
    try {
      decoded = atob(auth.slice(6));
    } catch {
      return unauthorized();
    }
    const sep = decoded.indexOf(':');
    const user = decoded.slice(0, sep);
    const pass = decoded.slice(sep + 1);
    if (sep !== -1 && users[user] && users[user] === pass) {
      return next();
    }
  }

  return unauthorized();
}
