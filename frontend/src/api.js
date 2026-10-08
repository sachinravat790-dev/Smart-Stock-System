const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "")
  .trim()
  .replace(/\/+$/, "");

export function apiFetch(path, options = {}) {
  const url = typeof path === "string" && path.startsWith("/api/")
    ? `${apiBaseUrl}${path}`
    : path;

  return fetch(url, { ...options, credentials: "include" });
}
