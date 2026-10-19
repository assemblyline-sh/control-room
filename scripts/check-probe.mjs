// @ts-check

/**
 * Fails when src-tauri/resources/probe.js isn't byte-identical to the probe of
 * the al-control version pinned in package.json (al-control decision 0006).
 *
 *   npm run check:probe            check
 *   npm run check:probe -- --copy  replace the bundled copy with the pinned one
 */

import { copyFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pinned = fileURLToPath(import.meta.resolve('@assemblyline/al-control/probe'));
const bundled = fileURLToPath(new URL('../src-tauri/resources/probe.js', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('../node_modules/@assemblyline/al-control/package.json', import.meta.url), 'utf8'));

if (process.argv.includes('--copy')) {
  copyFileSync(pinned, bundled);
  console.log(`Copied al-control ${version}'s probe to src-tauri/resources/probe.js`);
} else if (readFileSync(pinned).equals(readFileSync(bundled))) {
  console.log(`probe.js matches al-control ${version}`);
} else {
  console.error(`src-tauri/resources/probe.js differs from al-control ${version}'s probe.`);
  console.error('Never edit it here: change it in al-control, release, bump the pin, then run `npm run check:probe -- --copy`.');
  process.exit(1);
}
