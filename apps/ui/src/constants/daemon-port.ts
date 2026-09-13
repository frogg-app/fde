/**
 * The port a Frogg daemon listens on when nothing else is configured. The daemon
 * speaks HTTP and WebSocket on this single port. Frogg used 9999; typing that
 * port explicitly still works everywhere, only the default moved.
 */
import { brand } from "@frogg/branding";
export const DEFAULT_DAEMON_PORT = brand.daemonPort;
