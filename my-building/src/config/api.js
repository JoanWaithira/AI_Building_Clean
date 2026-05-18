const trimTrailingSlashes = (value) => String(value || "").replace(/\/+$/, "");

const DEFAULT_CHAT_API_BASE = "https://gate-chat-api-tln9.onrender.com";

export const CHAT_API_BASE = trimTrailingSlashes(
  import.meta.env.VITE_MCP_API_URL || DEFAULT_CHAT_API_BASE
);

export const CHAT_API_PATH = import.meta.env.VITE_MCP_CHAT_PATH || "/chat";

export function buildApiUrl(base, path) {
  const cleanPath = `/${String(path || "").replace(/^\/+/, "")}`;
  if (!base) return cleanPath;
  return `${base}${cleanPath}`;
}
