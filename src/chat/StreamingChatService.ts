import type { CharacterState, InferenceMessage, ProviderConfig } from '../core/types';
import { ContextAssembler } from '../agent/ContextAssembler';
import { MemoryManager } from '../memory/MemoryManager';
import { AgentRegistry } from '../agent/AgentRegistry';
import { ProximityManager } from '../proximity/ProximityManager';
import { ChatHistory } from './ChatHistory';
import { TypedEventEmitter } from '../core/events';
import { ProximityError, AgentError } from '../core/errors';
import { getLogger } from '../core/logger';

/**
 * Expansion 14: Streaming Chat Responses
 *
 * Token-by-token streaming for real-time chat responses.
 * Uses SSE-compatible streaming from OpenAI-compatible APIs.
 */
export class StreamingChatService {
  private contextAssembler = new ContextAssembler();
  private log = getLogger('streaming-chat');

  constructor(
    private history: ChatHistory,
    private registry: AgentRegistry,
    private memory: MemoryManager,
    private proximity: ProximityManager,
    private emitter: TypedEventEmitter,
    private providerConfig: ProviderConfig,
  ) {}

  /**
   * Stream a chat response token by token.
   * Returns an async iterator of content chunks.
   */
  async *streamMessage(
    characterId: string,
    playerId: string,
    message: string,
  ): AsyncGenerator<string, void, unknown> {
    if (!this.proximity.canChat(characterId, playerId)) {
      throw new ProximityError(`Cannot chat with character ${characterId} (closeness too low)`);
    }

    const character = this.registry.get(characterId);
    if (!character) {
      throw new AgentError(`Character not found: ${characterId}`, characterId);
    }

    // Record player message
    this.history.add(characterId, playerId, 'player', message);
    this.memory.addWorkingMemory(characterId, playerId, 'user', message);

    // Build context
    const chatHistory = this.history.getRecent(characterId, playerId, 10);
    const memContext = this.memory.getContext(characterId, playerId);
    const messages = this.contextAssembler.assembleChat({
      character,
      chatHistory: chatHistory.map(m => ({ role: m.role, content: m.content })),
      episodicMemories: memContext.episodicMemories,
      characterSummary: memContext.characterSummary,
      playerMessage: message,
    });

    // Stream from provider
    const fullContent: string[] = [];
    const baseUrl = this.providerConfig.baseUrl ?? 'http://localhost:1234/v1';
    const model = this.providerConfig.models.mid;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.providerConfig.apiKey
          ? { 'Authorization': `Bearer ${this.providerConfig.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        max_tokens: 300,
        temperature: 0.8,
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Streaming request failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(trimmed.slice(6));
            const content = data.choices?.[0]?.delta?.content;
            if (content) {
              fullContent.push(content);
              yield content;
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Record full response
    const fullText = fullContent.join('');
    this.history.add(characterId, playerId, 'character', fullText);
    this.memory.addWorkingMemory(characterId, playerId, 'assistant', fullText);
    this.proximity.boostFromChat(characterId, playerId);

    this.log.debug({ characterId, playerId, length: fullText.length }, 'Stream complete');
  }
}
