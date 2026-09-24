import {runJob,validate} from '../../lib/generation.mjs';
import {getJobStore} from '../../lib/store.mjs';
export default async function(request) {
  if (request.method !== 'POST') return;
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return;
  if (Number(request.headers.get('content-length')) > 64000) return;
  let input;
  try {input=validate(await request.json());} catch {return;}
  await runJob(input,await getJobStore());
}
