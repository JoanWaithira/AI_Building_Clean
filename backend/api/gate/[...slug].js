/**
 * Vercel serverless proxy for the Gate Building API.
 *
 * Routes: /api/gate/** → https://citylab.gate-ai.eu/gate-building/api/**
 *
 * The API key is read from the GATE_BUILDING_API_KEY environment variable
 * (set in Vercel project settings — never committed to source).
 * It is injected as the X-API-Key header server-side, so it is never
 * exposed in the browser bundle or DevTools network tab.
 */

const UPSTREAM_BASE = "https://citylab.gate-ai.eu/gate-building/api";

/** @type {import('@vercel/node').VercelRequest} req */
export default async function handler(req, res) {
  // Build the upstream path from the catch-all slug segments
  const slug = Array.isArray(req.query.slug)
    ? req.query.slug.join("/")
    : req.query.slug ?? "";

  // Forward all query params except the internal 'slug' routing param
  const upstream = new URL(`${UPSTREAM_BASE}/${slug}`);
  const incoming = new URL(req.url, "http://localhost");
  for (const [key, value] of incoming.searchParams.entries()) {
    if (key !== "slug") upstream.searchParams.set(key, value);
  }

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstream.toString(), {
      method: req.method ?? "GET",
      headers: {
        "X-API-Key": process.env.GATE_BUILDING_API_KEY ?? "",
        Accept: "application/json",
      },
      // Forward request body for POST/PUT if present
      ...(req.method !== "GET" && req.method !== "HEAD" && req.body
        ? { body: JSON.stringify(req.body) }
        : {}),
    });
  } catch (err) {
    console.error("[gate-proxy] Upstream fetch failed:", err.message);
    res.status(502).json({ error: "upstream_unavailable", message: err.message });
    return;
  }

  // Copy relevant response headers
  const contentType = upstreamResponse.headers.get("content-type") ?? "application/json";
  res.setHeader("Content-Type", contentType);

  // Propagate upstream status and body
  const body = await upstreamResponse.text();
  res.status(upstreamResponse.status).send(body);
}
