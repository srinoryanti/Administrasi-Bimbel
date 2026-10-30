import { httpServerHandler } from 'cloudflare:node';

const inner = httpServerHandler({ port: 4000 });
const innerFetch = typeof inner?.fetch === 'function' ? inner.fetch.bind(inner) : inner;

let bootPromise = null;

function boot(env) {
  if (!bootPromise) {
    bootPromise = (async () => {
      for (const [key, value] of Object.entries(env)) {
        if (value !== null && typeof value === 'object') continue;
        process.env[key] = String(value);
      }
      process.env.CF_WORKER = '1';
      if (env.D1) globalThis.__CF_D1__ = env.D1;
      const { startServer } = await import('../server/src/index.js');
      await startServer(4000);
    })();
  }
  return bootPromise;
}

export default {
  async fetch(request, env, ctx) {
    await boot(env);
    return innerFetch(request, env, ctx);
  },
};
