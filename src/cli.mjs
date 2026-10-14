import { mkdir, readFile, writeFile, rename, appendFile } from 'node:fs/promises';
import { buildBatch, configurationFingerprint, recordValidation } from './sync.mjs';
import { safeMessage } from './sources.mjs';

async function atomicJSON(path, value) {
  const temp = path + '.tmp';
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n');
  await rename(temp, path);
}

async function main() {
  const env = process.env;
  const { feed, summary } = await buildBatch(env);
  console.log(JSON.stringify({ status: 'validated', generated_at: feed.generated_at, ...summary }));
  // Local tests and fixture runs never count as successful cloud syncs.
  if (env.GITHUB_ACTIONS !== 'true' || !env.GITHUB_RUN_ID) return;
  const sourceTexts = await Promise.all(['radar-core.mjs', 'sources.mjs', 'sync.mjs', 'cli.mjs'].map(file => readFile(new URL(file, import.meta.url), 'utf8')));
  const fingerprint = configurationFingerprint(sourceTexts, env);
  let previous;
  try { previous = JSON.parse(await readFile('state/validation.json', 'utf8')); } catch { previous = null; }
  const state = recordValidation(previous, fingerprint, { runId: env.GITHUB_RUN_ID, at: new Date(feed.generated_at), validated: summary.validated });
  await mkdir('state', { recursive: true });
  await atomicJSON('state/validation.json', state);
  const ready = env.RADAR_PUBLISH_ENABLED === 'true' && state.checks.length >= 2;
  if (ready) {
    await mkdir('_site/api/radar', { recursive: true });
    await atomicJSON('_site/api/radar/latest.json', feed);
    await atomicJSON('_site/api/radar/health.json', { section_id: feed.section_id, generated_at: feed.generated_at, valid_until: feed.valid_until, product_count: feed.products.length });
    await writeFile('_site/.nojekyll', '');
    await writeFile('_site/index.html', '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="robots" content="noindex"><title>رادار بارعة</title><p>تغذية مختارات بارعة اليومية.</p><a href="api/radar/latest.json">عرض ملف البيانات</a></html>');
  }
  if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `publish_ready=${ready}\n`);
  console.log(JSON.stringify({ live_checks: state.checks.length, publish_ready: ready }));
}

main().catch(error => {
  console.error(safeMessage(error));
  process.exitCode = 1;
});
