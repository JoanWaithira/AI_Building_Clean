const GATE_API_BASE = (
  import.meta.env.VITE_GATE_API_BASE ||
  "https://citylab.gate-ai.eu/gate-building/api"
).replace(/\/+$/, "");

const GATE_API_KEY = import.meta.env.VITE_GATE_API_KEY || "";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;

export class GateApiError extends Error {
  constructor(message, status, endpoint) {
    super(message);
    this.name = "GateApiError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

function buildGateUrl(path, params = {}) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const rawUrl = `${GATE_API_BASE}${cleanPath}`;

  const url =
    rawUrl.startsWith("http://") || rawUrl.startsWith("https://")
      ? new URL(rawUrl)
      : new URL(rawUrl, window.location.origin);

  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  });

  return url;
}

export async function gateGet(path, params = {}, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = MAX_RETRIES,
    signal,
  } = options;

  const url = buildGateUrl(path, params);

  const headers = {
    Accept: "application/json",
    ...(GATE_API_KEY ? { "X-API-Key": GATE_API_KEY } : {}),
  };

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));
    }

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

    const combinedSignal = signal
      ? anySignal([signal, timeoutController.signal])
      : timeoutController.signal;

    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers,
        signal: combinedSignal,
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        return res.json();
      }

      const isRetryable = res.status >= 500;
      lastError = new GateApiError(
        `[GateAPI] ${path} → HTTP ${res.status}`,
        res.status,
        path,
      );

      if (!isRetryable) throw lastError;
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof GateApiError) {
        lastError = err;
        continue;
      }

      if (err.name === "AbortError") {
        throw new GateApiError(
          `[GateAPI] ${path} → request timed out after ${timeoutMs} ms`,
          0,
          path,
        );
      }

      lastError = new GateApiError(
        `[GateAPI] ${path} → ${err.message}`,
        0,
        path,
      );
    }
  }

  throw lastError;
}

export async function gateGetAll(requests) {
  const settled = await Promise.allSettled(requests.map((fn) => fn()));
  return settled.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    console.warn(`[GateAPI] parallel request ${i} failed:`, r.reason?.message);
    return null;
  });
}

function anySignal(signals) {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) {
      controller.abort();
      break;
    }
    sig.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}
