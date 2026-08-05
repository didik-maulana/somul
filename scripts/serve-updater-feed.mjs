/**
 * Serves a published updater feed — `latest.json` and the `.app.tar.gz` beside it.
 *
 * Exists instead of `python3 -m http.server` for one reason: the bandwidth limit. A local feed
 * hands over the whole bundle in a few hundred milliseconds, so the download progress the panel
 * draws is over before it can be looked at, and the one part of the update UI that cannot be
 * checked any other way goes untested. Throttling turns the transfer back into something with a
 * middle.
 *
 *   node scripts/serve-updater-feed.mjs <directory> [port] [kilobytesPerSecond]
 *
 * A rate of 0 means no limit.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const [directory, port = '8000', kilobytesPerSecond = '0'] = process.argv.slice(2);

if (!directory) {
  console.error('Usage: node scripts/serve-updater-feed.mjs <directory> [port] [kbps]');
  process.exit(1);
}

const rate = Number(kilobytesPerSecond) * 1024;

const CONTENT_TYPES = {
  '.json': 'application/json',
  '.gz': 'application/gzip',
};

/**
 * Writes the file out in one-tenth-of-a-second portions.
 *
 * `Content-Length` is sent up front regardless of the rate — it is what lets the updater report a
 * percentage rather than an indeterminate bar, so dropping it would quietly test the wrong path.
 */
const sendThrottled = async (response, path, size) => {
  const chunkSize = Math.max(Math.floor(rate / 10), 1);

  for await (const chunk of createReadStream(path, { highWaterMark: chunkSize })) {
    if (!response.write(chunk)) {
      await new Promise((resolve) => response.once('drain', resolve));
    }

    await sleep(100);
  }

  response.end();
  console.log(`  sent ${path} (${size} bytes, ${kilobytesPerSecond} kB/s)`);
};

const server = createServer((request, response) => {
  // `normalize` before joining: a request for `/../../etc/passwd` is a path, and this server is
  // pointed at a build directory rather than a public root.
  const requested = normalize(decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  const path = join(directory, requested);

  if (!path.startsWith(directory) || !existsSync(path) || statSync(path).isDirectory()) {
    response.writeHead(404).end('Not found');
    return;
  }

  const { size } = statSync(path);
  const extension = path.slice(path.lastIndexOf('.'));

  response.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'Content-Length': size,
  });

  console.log(`GET ${requested}`);

  if (rate <= 0) {
    createReadStream(path).pipe(response);
    return;
  }

  void sendThrottled(response, path, size);
});

server.listen(Number(port), () => {
  const limit = rate > 0 ? `${kilobytesPerSecond} kB/s` : 'no limit';

  console.log(`Serving ${directory} on http://localhost:${port} (${limit})`);
});
