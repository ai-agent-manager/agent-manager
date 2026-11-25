// Only used by the Imposter integration child, which launches the compiled CLI.
// Keep the test provider's synthetic tokens entirely within its temporary HOME.
// dist/ is a bundle, so instead of reaching into token-store we make the native
// keyring addon unresolvable; token-store then falls back to filesystem storage.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@napi-rs/keyring') throw new Error('Keychain disabled for integration tests');
    return nextResolve(specifier, context);
  },
});
