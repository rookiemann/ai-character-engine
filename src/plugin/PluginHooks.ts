import type { GamePlugin } from './GamePlugin';
import { getLogger } from '../core/logger';

const log = getLogger('plugin-hooks');

/**
 * Safely call a plugin lifecycle hook, catching and logging errors.
 */
export async function callHook<K extends keyof GamePlugin>(
  plugin: GamePlugin,
  hook: K,
  ...args: GamePlugin[K] extends (...a: infer A) => unknown ? A : never[]
): Promise<void> {
  const fn = plugin[hook];
  if (typeof fn !== 'function') return;

  try {
    await (fn as Function).apply(plugin, args);
  } catch (error) {
    log.error({ pluginId: plugin.id, hook, error }, 'Plugin hook error');
  }
}
