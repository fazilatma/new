/**
 * Phusion Passenger entry point for cPanel shared hosting.
 * =======================================================
 *
 * Copy this file to the root of your cPanel "Application root" as `app.js`
 * (that is the default name in Setup Node.js App) next to the uploaded
 * `render-dist/` folder.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * On cPanel the app is NOT started with `npm start` or `node server.js`.
 * Passenger imports the configured startup file directly and assigns the port
 * itself through `process.env.PORT`. `render-dist/server.js` already reads
 * `process.env.PORT`, so this wrapper only has to import it — do not call
 * `listen()` again and do not hardcode a port.
 *
 * See CPANEL-SHARED-HOSTING.md for the full deployment walkthrough.
 */

// A crash during import is otherwise swallowed by Passenger and surfaces only
// as a bare 503, so log it where cPanel's error log will show it.
process.on('unhandledRejection', (error) => {
  console.error('[scraper4] unhandled rejection during startup:', error);
});
process.on('uncaughtException', (error) => {
  console.error('[scraper4] uncaught exception:', error);
});

await import('./render-dist/server.js');
