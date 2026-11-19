import { withMutation, installMutationSignalHandlers } from '../../src/lib/mutation.js';
import { removeInstalled } from '../../src/operations/manage.js';
import { removeCachedBundle } from '../../src/bundle/cache.js';
installMutationSignalHandlers();
const [operation, value] = process.argv.slice(2);
try {
  await withMutation(async () => {
    process.send?.('entered');
    if (operation === 'hold') await new Promise<void>((resolve) => process.once('message', () => resolve()));
    else if (operation === 'remove') await removeInstalled(value, 'system', 'claude-code');
    else if (operation === 'delete') await removeCachedBundle(value);
  }, { onWait: () => process.send?.('waiting') });
  process.send?.('done');
} catch (error) {
  process.send?.({ error: error instanceof Error ? error.message : String(error), statusCode: (error as { statusCode?: number }).statusCode });
}
process.disconnect?.();
