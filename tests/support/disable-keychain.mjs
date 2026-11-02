// Only used by the Imposter integration child, which launches the compiled CLI.
// Keep the test provider's synthetic tokens entirely within its temporary HOME.
import { _disableKeychain } from '../../dist/auth/token-store.js';
_disableKeychain();
