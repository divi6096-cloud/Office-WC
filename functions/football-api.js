// Cloudflare Pages Function — proxies football-data.org so the API key stays server-side.
// File location: /functions/football-api.js  (repo root, NOT src/)
// Reachable in the browser at: /football-api?endpoint=competitions/WC/matches?season=2026
//
// Required env var (set in Cloudflare Pages → Settings → Environment variables):
//   FOOTBALL_API_KEY = your football-data.org auth token

export async function onRequest(context) {
  const { request, env } = context
  const url = new URL(request.url)
  const endpoint = url.searchParams.get('endpoint')

  const headers = { 'Content-Type': 'application/json' }

  if (!endpoint) {
    return new Response(JSON.stringify({ error: 'Missing endpoint parameter' }), { status: 400, headers })
  }

  // Only allow the football-data competition endpoints this app actually uses.
  // Prevents the function being abused as an open proxy.
  if (!/^competitions\/[A-Za-z0-9/?=&_-]+$/.test(endpoint)) {
    return new Response(JSON.stringify({ error: 'Endpoint not allowed' }), { status: 403, headers })
  }

  const key = env.FOOTBALL_API_KEY
  if (!key) {
    return new Response(JSON.stringify({ error: 'FOOTBALL_API_KEY is not configured on the server' }), { status: 500, headers })
  }

  try {
    const upstream = await fetch(`https://api.football-data.org/v4/${endpoint}`, {
      headers: { 'X-Auth-Token': key },
    })
    const body = await upstream.text()
    return new Response(body, { status: upstream.status, headers })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'Upstream fetch failed' }), { status: 502, headers })
  }
}
