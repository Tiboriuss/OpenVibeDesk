import type { UiLocale } from '../../shared/locale';
import type { McpConnectFailure } from '../../shared/mcp';

export const connectFailureText = {
  en: {
    cancelled: 'Connection cancelled.',
    oauth_required: 'Sign in under MCP settings, then connect again.',
    authentication: 'Check the bearer token or sign in with OAuth under MCP settings.',
    unsupported_version: 'The server and OVD could not agree on an MCP version. Check whether the server supports MCP 2025-11-25.',
    initialize_unavailable: 'The server does not accept MCP initialization. Check the endpoint or enable support for the 2025-11-25 handshake on the server.',
    header_mismatch: 'The server rejected the MCP routing headers during initialization. Check whether the endpoint accepts the 2025-11-25 handshake.',
    connection_failed: 'Could not connect. Check the program, arguments and working directory for Stdio, or the endpoint and credentials for HTTP.'
  },
  de: {
    cancelled: 'Verbindungsaufbau abgebrochen.',
    oauth_required: 'Melde dich in den MCP-Einstellungen an und verbinde den Server erneut.',
    authentication: 'Prüfe den Bearer-Token oder melde dich in den MCP-Einstellungen über OAuth an.',
    unsupported_version: 'OVD und der Server konnten sich auf keine MCP-Version einigen. Prüfe, ob der Server MCP 2025-11-25 unterstützt.',
    initialize_unavailable: 'Der Server akzeptiert die MCP-Initialisierung nicht. Prüfe den Endpunkt oder aktiviere am Server die Unterstützung für den Handshake von 2025-11-25.',
    header_mismatch: 'Der Server hat die MCP-Routing-Header bei der Initialisierung abgelehnt. Prüfe, ob der Endpunkt den Handshake von 2025-11-25 akzeptiert.',
    connection_failed: 'Verbindung fehlgeschlagen. Prüfe bei Stdio Programm, Argumente und Arbeitsordner, bei HTTP den Endpunkt und die Zugangsdaten.'
  }
} satisfies Record<UiLocale, Record<McpConnectFailure, string>>;
