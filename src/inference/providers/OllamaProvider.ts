import { LMStudioProvider } from './LMStudioProvider';
import type { ProviderConfig } from '../../core/types';

/**
 * Ollama provider - OpenAI-compatible API at localhost:11434.
 * Extends LMStudioProvider since the API shape is identical.
 */
export class OllamaProvider extends LMStudioProvider {
  constructor(config: ProviderConfig) {
    if (!config.baseUrl) {
      config = { ...config, baseUrl: 'http://localhost:11434/v1' };
    }
    super(config);
  }

  get name(): string {
    return 'ollama';
  }
}
