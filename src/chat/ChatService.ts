import type { ChatMessage, CharacterState } from '../core/types';
import type { MiddlewarePipeline, MiddlewareContext } from '../core/Middleware';
import { ChatHistory } from './ChatHistory';
import { ContextAssembler } from '../agent/ContextAssembler';
import { MemoryManager } from '../memory/MemoryManager';
import { InferenceService } from '../inference/InferenceService';
import { ProximityManager } from '../proximity/ProximityManager';
import { AgentRegistry } from '../agent/AgentRegistry';
import { TypedEventEmitter } from '../core/events';
import { ProximityError, AgentError } from '../core/errors';
import { getLogger } from '../core/logger';

/**
 * Direct chat with close characters.
 * Characters must meet the closeness threshold to chat.
 */
export class ChatService {
  private contextAssembler = new ContextAssembler();
  private log = getLogger('chat');
  private middleware?: MiddlewarePipeline;

  constructor(
    private history: ChatHistory,
    private registry: AgentRegistry,
    private memory: MemoryManager,
    private inference: InferenceService,
    private proximity: ProximityManager,
    private emitter: TypedEventEmitter,
  ) {}

  /**
   * Attach middleware pipeline for before/after hooks.
   */
  setMiddleware(pipeline: MiddlewarePipeline): void {
    this.middleware = pipeline;
  }

  /**
   * Send a message to a character and get their response.
   */
  async sendMessage(
    characterId: string,
    playerId: string,
    message: string,
  ): Promise<ChatMessage> {
    // Check if character can chat
    if (!this.proximity.canChat(characterId, playerId)) {
      throw new ProximityError(`Cannot chat with character ${characterId} (closeness too low)`);
    }

    const character = this.registry.get(characterId);
    if (!character) {
      throw new AgentError(`Character not found: ${characterId}`, characterId);
    }

    // --- beforeChat middleware ---
    if (this.middleware) {
      const ctx: MiddlewareContext = {
        characterId,
        playerId,
        phase: 'beforeChat',
        character,
        metadata: { message },
      };
      await this.middleware.run('beforeChat', ctx);
      if (ctx.abort) {
        // Return a placeholder message on abort
        return {
          id: `msg_${Date.now()}`,
          characterId,
          playerId,
          role: 'character',
          content: '',
          createdAt: Date.now(),
        };
      }
    }

    // Record player message
    const playerMsg = this.history.add(characterId, playerId, 'player', message);
    this.emitter.emit('chat:message', playerMsg);

    // Also add to working memory
    this.memory.addWorkingMemory(characterId, playerId, 'user', message);

    // Get context for response
    const chatHistory = this.history.getRecent(characterId, playerId, 10);
    const memContext = this.memory.getContext(characterId, playerId);

    // Assemble chat context
    const messages = this.contextAssembler.assembleChat({
      character,
      chatHistory: chatHistory.map(m => ({ role: m.role, content: m.content })),
      episodicMemories: memContext.episodicMemories,
      characterSummary: memContext.characterSummary,
      playerMessage: message,
    });

    // Call LLM
    const response = await this.inference.complete({
      messages,
      tier: 'mid',
      maxTokens: 300,
      temperature: 0.8,
      characterId,
    });

    // Record character response
    const charMsg = this.history.add(characterId, playerId, 'character', response.content);
    this.emitter.emit('chat:message', charMsg);

    // Add to working memory
    this.memory.addWorkingMemory(characterId, playerId, 'assistant', response.content);

    // Record as episodic memory (dialogue)
    this.memory.recordEvent(
      characterId,
      playerId,
      { type: 'dialogue', source: playerId, target: characterId, timestamp: Date.now() },
      `Player said: "${message.slice(0, 100)}". ${character.name} replied: "${response.content.slice(0, 100)}"`,
      `Conversation with player about: ${message.slice(0, 50)}`,
      ['dialogue', 'chat'],
    );

    // Boost proximity from chat
    this.proximity.boostFromChat(characterId, playerId);

    // --- afterChat middleware ---
    if (this.middleware) {
      const ctx: MiddlewareContext = {
        characterId,
        playerId,
        phase: 'afterChat',
        character,
        metadata: { message, response: response.content },
      };
      await this.middleware.run('afterChat', ctx);
    }

    this.log.debug({ characterId, playerId, tokens: response.tokensUsed.total }, 'Chat response');

    return charMsg;
  }

  /**
   * Get chat history for a character.
   */
  getHistory(characterId: string, playerId: string, limit: number = 20): ChatMessage[] {
    return this.history.getRecent(characterId, playerId, limit);
  }
}
