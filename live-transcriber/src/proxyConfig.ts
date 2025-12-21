const fallbackProxyBaseUrl = "http://localhost:8080";

const rawProxyBaseUrl = (import.meta.env.VITE_PROXY_BASE_URL as string | undefined) || "";

export const proxyBaseUrl = (rawProxyBaseUrl || fallbackProxyBaseUrl).replace(/\/+$/, "");

export const proxyWsBaseUrl = (() => {
  try {
    const url = new URL(proxyBaseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString().replace(/\/+$/, "");
  } catch {
    // If someone provided a non-URL string, fall back to localhost.
    return "ws://localhost:8080";
  }
})();
