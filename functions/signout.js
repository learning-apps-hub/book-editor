// /signout — forget the Book Editor cookie on this device and go back to the sign-in page.
import { clearCookie } from '../server/session.js';

export function onRequestGet() {
  const r = new Response(null, { status: 302, headers: { location: '/signin/?out=1', 'cache-control': 'no-store' } });
  r.headers.append('set-cookie', clearCookie());
  return r;
}
