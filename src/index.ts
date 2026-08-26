/**
 * Side-chat plugin, node half.
 *
 * Deliberately empty: every behavior lives in the browser half (`./client`).
 * This entry exists so the Loader row resolves and the client-module scan
 * finds a package that declares `dsh.client` and exports `./client`.
 */

/** Host plugin body — browser-only plugin; nothing to mount on the host. */
export function apply(): void {}
