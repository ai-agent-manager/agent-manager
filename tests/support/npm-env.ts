import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** npm run exports absolute config/cache paths from the invoking user's home.
 * HOME alone does not isolate npm; replace all inherited npm configuration. */
export async function npmEnvironment(directory: string, inherited: NodeJS.ProcessEnv = process.env): Promise<NodeJS.ProcessEnv> {
  await mkdir(directory, { recursive: true });
  const userconfig = path.join(directory, 'npmrc'), globalconfig = path.join(directory, 'global-npmrc');
  await Promise.all([writeFile(userconfig, ''), writeFile(globalconfig, '')]);
  const env = Object.fromEntries(Object.entries(inherited).filter(([key]) => !/^npm_config_/i.test(key)));
  return { ...env, TMPDIR: directory, TMP: directory, TEMP: directory,
    npm_config_cache: path.join(directory, 'cache'), npm_config_userconfig: userconfig,
    npm_config_globalconfig: globalconfig, npm_config_prefix: path.join(directory, 'prefix') };
}
