import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { PUBLIC_PLAN_CREDIT_SEED } from '@meiye/contracts';

/**
 * Boot a second copy of the web app at a chosen 套餐月价 (#242).
 *
 * The number a visitor is quoted is copy, owned by
 * `src/lib/public-display-price.ts` and baked in at build time (D-156), so a
 * running server cannot be asked to change its mind about it. Observing that a
 * change actually reaches both public pages therefore needs a server started
 * from a different value — this is that server, and
 * `VITE_PUBLIC_QUOTED_MONTHLY_CENTS` is the override that module reads for
 * exactly this purpose. Nothing outside this harness sets it: it is not a
 * provisioning item, not a billing knob, and no operator console reaches it.
 *
 * It is the whole point of the exercise: two pages agreeing once proves nothing
 * about where the number came from, and a source-level guard cannot prove it
 * either. Moving the source and watching both pages move is what does.
 *
 * Nothing here touches the suite's own stack. The extra server runs on its own
 * free port, and its price is deliberately unlike any number written anywhere
 * in the product, so a page that quotes a literal quotes the wrong one.
 */

/**
 * The moved display price, in cents, as the test-harness override expresses it.
 *
 * Not a plausible plan price: a plausible one could coincide with a literal
 * someone typed. This one cannot be produced by any path except reading the
 * test-harness override.
 */
export const MOVED_MONTHLY_AMOUNT_CENTS = 727_300;

/**
 * What the landing must print once the test override says the above.
 *
 * Written out rather than composed from the amount. It used to be
 * `` `¥${MOVED_MONTHLY_AMOUNT_CENTS / 100}` `` — which produced `¥7273`, a
 * string the product has never rendered: prices are formatted, so the grouping
 * separator belongs in the expectation. Nothing caught it because the guard
 * that reads this constant had been failing earlier, on /pricing, since #310
 * (#346). Composing an expectation from the same inputs the product uses also
 * tends to restate the implementation back to itself; a literal a person can
 * read against the page is what is wanted here.
 */
export const MOVED_MONTHLY_PRICE_LABEL = '¥7,273';

/**
 * The moved published catalog price, in micros, as Core would publish it.
 *
 * `/pricing` reads its numbers from the Core plan catalog, not from the
 * display-price module above — two public surfaces, two sources (#346). Moving
 * this one is how the catalog half of "the source moved, did the page follow?"
 * gets asked, and it is deliberately unlike any figure written in the product
 * so a page quoting a literal quotes the wrong one.
 */
export const MOVED_CATALOG_MONTHLY_MICROS = 813_000_000;

/** What /pricing must print once the stub catalog publishes the above. */
export const MOVED_CATALOG_PRICE_LABEL = 'HK$813';

/**
 * A Core stand-in that publishes one plan catalog and nothing else.
 *
 * Only the public plan catalog is served: it is the single Core read the two
 * public pages make, so a stub this narrow is enough to move the catalog out
 * from under `/pricing` and watch what follows. Anything else this app asks
 * Core for is a route these tests do not visit.
 */
export interface StubCoreCatalog {
  url: string;
  stop: () => Promise<void>;
}

export async function startStubCoreCatalog(
  growthMonthlyMicros: number
): Promise<StubCoreCatalog> {
  const catalog = {
    addOns: [],
    plans: PUBLIC_PLAN_CREDIT_SEED.map((plan) =>
      plan.id === 'growth'
        ? {
            ...plan,
            cyclePrices: plan.cyclePrices.map((price) =>
              price.cycle === 'monthly'
                ? { ...price, amountMicros: growthMonthlyMicros }
                : price
            ),
          }
        : plan
    ),
  };

  const port = await findFreePort();
  const server: Server = createHttpServer((request, response) => {
    if (!request.url?.startsWith('/public/plan-catalog')) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: catalog }));
  });

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  return {
    url: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

export interface RepricedWebApp {
  baseURL: string;
  stop: () => Promise<void>;
}

async function findFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (typeof address === 'string' || address === null) {
        probe.close(() => reject(new Error('could not resolve a free port')));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(
  baseURL: string,
  child: ChildProcess,
  log: () => string,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `repriced web app exited with code ${child.exitCode}:\n${log()}`
      );
    }
    try {
      const response = await fetch(baseURL, { redirect: 'manual' });
      if (response.status < 500) return;
    } catch {
      // not listening yet
    }
    await delay(1000);
  }
  throw new Error(
    `repriced web app did not answer on ${baseURL} within ${timeoutMs}ms:\n${log()}`
  );
}

/**
 * Start the web app with `VITE_PUBLIC_QUOTED_MONTHLY_CENTS` set to `cents`.
 *
 * `PARAGLIDE_PRECOMPILED=true` on purpose: the suite's own stack already
 * compiled the locale output, and recompiling it here would rewrite files the
 * running stack is serving from.
 */
export async function startRepricedWebApp(
  cents: number,
  options: { timeoutMs?: number; coreServiceURL?: string } = {}
): Promise<RepricedWebApp> {
  const port = await findFreePort();
  const baseURL = `http://localhost:${port}`;
  const databaseURL =
    process.env.TEST_DATABASE_URL ??
    'postgres://meiye:meiye@127.0.0.1:54329/meiye';
  const corePort = process.env.PLAYWRIGHT_CORE_PORT ?? '4100';
  // Which Core this app reads its published catalog from. Defaults to the
  // suite's own, so moving only the display price leaves the catalog exactly
  // where it was — that difference is what the anti-crosstalk leg reads.
  const coreServiceURL =
    options.coreServiceURL ?? `http://127.0.0.1:${corePort}`;

  const child = spawn(
    'pnpm',
    [
      'exec',
      'vite',
      'dev',
      '--port',
      String(port),
      '--strictPort',
      '--mode',
      'e2e',
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_ENV: 'e2e',
        BETTER_AUTH_SECRET: 'e2e-better-auth-secret',
        CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: databaseURL,
        CORE_SERVICE_TOKEN: 'local-core-service-token',
        CORE_SERVICE_URL: coreServiceURL,
        DATABASE_URL: databaseURL,
        PARAGLIDE_PRECOMPILED: 'true',
        VITE_BASE_URL: baseURL,
        VITE_PUBLIC_QUOTED_MONTHLY_CENTS: String(cents),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let output = '';
  const collect = (chunk: Buffer) => {
    output += chunk.toString();
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    for (let i = 0; i < 50 && child.exitCode === null; i += 1) {
      await delay(100);
    }
    if (child.exitCode === null) child.kill('SIGKILL');
  };

  try {
    await waitForServer(
      baseURL,
      child,
      () => output.slice(-4000),
      options.timeoutMs ?? 180_000
    );
  } catch (error) {
    await stop();
    throw error;
  }

  return { baseURL, stop };
}
