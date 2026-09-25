import { Agent, setGlobalDispatcher } from "undici";

let configured = false;

/**
 * Installs a global undici dispatcher with stall-based timeouts and an
 * explicit IPv4 fallback, so a hung network path fails fast and visibly
 * instead of hanging on undici's stock 5-minute headers/body timeouts.
 *
 * Timeouts are stall-based (time between bytes), not deadline-based (total
 * elapsed time), so a slow-but-progressing multi-megabyte bundle download is
 * never killed while a dead connection still fails quickly.
 *
 * Safe to call more than once; only the first call takes effect.
 */
export function configureHttpDefaults(): void {
    if (configured) {
        return;
    }
    configured = true;

    setGlobalDispatcher(
        new Agent({
            headersTimeout: 30_000,
            bodyTimeout: 60_000,
            connect: {
                timeout: 10_000,
                autoSelectFamily: true,
                autoSelectFamilyAttemptTimeout: 500,
            },
        }),
    );
}

interface NodeErrorLike {
    code?: string;
    cause?: unknown;
}

function unwrapCause(err: unknown): unknown {
    let current = err;
    // Follow err.cause chains (fetch wraps the underlying undici error this way).
    while (current instanceof Error && (current as NodeErrorLike).cause) {
        current = (current as NodeErrorLike).cause;
    }
    return current;
}

const NETWORK_ERROR_MESSAGES: Record<string, string> = {
    UND_ERR_CONNECT_TIMEOUT:
        "Connection timed out. This can happen on networks where IPv6 connectivity is broken " +
        "but still preferred (common on some corporate/VPN networks) — check your network's " +
        "IPv6 configuration or try again on a different network.",
    UND_ERR_HEADERS_TIMEOUT:
        "The server accepted the connection but never sent a response. This can happen if a " +
        "proxy, firewall, or broken IPv6 path is silently dropping traffic — check your network " +
        "configuration or try again on a different network.",
    UND_ERR_BODY_TIMEOUT:
        "The download stalled partway through and was aborted. Check your network connection and try again.",
    ETIMEDOUT: "Connection timed out. Check your network connection and try again.",
    ENOTFOUND: "Could not resolve the host name. Check the URL and your DNS configuration.",
    EAI_AGAIN: "Temporary DNS resolution failure. Check your network connection and try again.",
    ECONNREFUSED: "Connection refused by the server. The host may be down or blocking the connection.",
    ECONNRESET: "The connection was reset by the server or network. Check your network connection and try again.",
};

/**
 * Maps a raw fetch/undici/Node network error to an actionable message,
 * unwrapping `cause` chains. Returns undefined when the error isn't a
 * recognised network failure, so callers can fall back to the original message.
 */
export function describeNetworkError(err: unknown): string | undefined {
    const resolved = unwrapCause(err);

    if (!(resolved instanceof Error)) {
        return undefined;
    }

    const code = (resolved as NodeErrorLike).code;
    if (code) {
        if (NETWORK_ERROR_MESSAGES[code]) {
            return NETWORK_ERROR_MESSAGES[code];
        }
        if (code.startsWith("CERT_") || code.startsWith("ERR_TLS")) {
            return `TLS certificate error (${code}). This can happen if a corporate proxy or firewall is intercepting HTTPS traffic.`;
        }
    }

    if (resolved.name === "AbortError" || resolved.name === "TimeoutError") {
        return "The request timed out. Check your network connection and try again.";
    }

    return undefined;
}
