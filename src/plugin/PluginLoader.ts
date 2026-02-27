import type { GamePlugin } from './GamePlugin';
import { PluginError } from '../core/errors';
import { getLogger } from '../core/logger';

const log = getLogger('plugin-loader');

const REQUIRED_METHODS: (keyof GamePlugin)[] = [
  'id', 'name', 'getArchetypes', 'getTools', 'getGameState', 'getProprioception',
];

/**
 * Validates and loads a GamePlugin, ensuring it implements required methods.
 */
export function validatePlugin(plugin: unknown): GamePlugin {
  if (!plugin || typeof plugin !== 'object') {
    throw new PluginError('Plugin must be a non-null object');
  }

  const p = plugin as Record<string, unknown>;

  for (const method of REQUIRED_METHODS) {
    if (!(method in p)) {
      throw new PluginError(`Plugin missing required property: ${method}`);
    }
  }

  if (typeof p.id !== 'string' || p.id.length === 0) {
    throw new PluginError('Plugin id must be a non-empty string');
  }

  if (typeof p.name !== 'string' || p.name.length === 0) {
    throw new PluginError('Plugin name must be a non-empty string');
  }

  for (const method of ['getArchetypes', 'getTools', 'getGameState', 'getProprioception']) {
    if (typeof p[method] !== 'function') {
      throw new PluginError(`Plugin.${method} must be a function`);
    }
  }

  log.info({ pluginId: p.id, pluginName: p.name }, 'Plugin validated');
  return plugin as GamePlugin;
}

/**
 * Loads and initializes a plugin.
 */
export async function loadPlugin(plugin: GamePlugin): Promise<void> {
  if (plugin.initialize) {
    await plugin.initialize();
    log.info({ pluginId: plugin.id }, 'Plugin initialized');
  }
}
