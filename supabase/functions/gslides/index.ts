// Google Slides → Church Service. Browsers may not download a Google Slides export directly (Google does not
// allow it from other websites), so the app asks this small function, which downloads the export of a deck
// shared as "Anyone with the link" and hands it back. Nothing is stored.
//   GET /functions/v1/gslides?id=<presentation id>&format=pdf|pptx
// Deploy: supabase functions deploy gslides
const ID = /^[A-Za-z0-9_-]{20,100}$/;
const MAX = 80 * 1024 * 1024;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const fail = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'GET') return fail(405, 'GET only');
  const u = new URL(req.url);
  const id = u.searchParams.get('id') || '';
  const format = u.searchParams.get('format') === 'pptx' ? 'pptx' : 'pdf';
  if (!ID.test(id)) return fail(400, 'That is not a Google Slides link.');
  let r: Response;
  try {
    r = await fetch(`https://docs.google.com/presentation/d/${id}/export/${format}`, { redirect: 'follow' });
  } catch (_e) {
    return fail(502, 'Google Slides could not be reached.');
  }
  const type = r.headers.get('content-type') || '';
  if (r.status === 404) return fail(404, 'This presentation was not found.');
  // A deck that is not shared sends people to the Google sign-in page instead of the file.
  if (!r.ok || type.includes('text/html')) return fail(403, 'This presentation is not shared. In Google Slides: Share → General access → “Anyone with the link”.');
  const len = Number(r.headers.get('content-length') || 0);
  if (len > MAX) return fail(413, 'This presentation is too large to download here.');
  return new Response(r.body, {
    headers: {
      ...cors,
      'Content-Type': format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Cache-Control': 'no-store',
    },
  });
});
