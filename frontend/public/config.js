// Kadak AirMenu — runtime frontend configuration.
//
// Loaded by index.html BEFORE the app bundle, and never bundled or hashed by
// Vite, so it can be edited on the server without rebuilding the frontend.
// Servers must send it with "Cache-Control: no-store" (the Express server and
// deploy/nginx/kadak.conf.template both do).
//
// API_BASE_URL — where the backend lives. The app appends /api/... and
// /uploads/... to it.
//   ""                          same origin (default). Correct for local dev
//                               (Vite proxies to :4000), for the backend
//                               serving the built app, and for the AWS
//                               layout where Nginx proxies /api and /uploads.
//   "https://api.example.com"   backend on a different host. No trailing
//                               slash, no "/api" suffix. Must be https:// when
//                               the site itself is served over https://.
//
// PUBLIC FILE: never put passwords, database URLs, keys or tokens here.
window.APP_CONFIG = {
  API_BASE_URL: ""
};
