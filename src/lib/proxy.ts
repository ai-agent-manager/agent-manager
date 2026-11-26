import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

const PROXY_ENV_VARS = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy'] as const;

/**
 * Node's global `fetch` (undici) does not read HTTP_PROXY/HTTPS_PROXY/NO_PROXY on
 * its own, unlike npm. Without this, every outbound request bypasses a configured
 * forward proxy. EnvHttpProxyAgent reads those env vars (plus NO_PROXY) itself and
 * picks the right upstream per request.
 */
export function configureProxyFromEnv(): void {
  if (!PROXY_ENV_VARS.some((name) => process.env[name])) return;
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
