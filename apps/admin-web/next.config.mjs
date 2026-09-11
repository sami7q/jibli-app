import { portalNextConfig } from '../../config/next-portal.mjs';

/**
 * Both portals share one configuration so a security header or a resolver fix
 * can never land on only one of them. App-specific overrides go here.
 */
export default portalNextConfig;
