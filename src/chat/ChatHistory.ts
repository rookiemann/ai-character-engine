import type { ChatMessage } from '../core/types';
import { ChatRepository } from '../db/repositories/ChatRepository';

/**
 * Chat history storage and retrieval.
 * Wraps ChatRepository with caching for active conversations.
 */
export class ChatHistory {
  private cache = new Map<string, ChatMessage[]>();

  constructor(private repo: ChatRepository) {}

  private key(characterId: string, playerId: string): string {
    return `${characterId}:${playerId}`;
  }

  /**
   * Add a message to chat history.
   */
  add(
    characterId: string,
    playerId: string,
    role: 'player' | 'character',
    content: string,
  ): ChatMessage {
    const msg = this.repo.addMessage({
      characterId,
      playerId,
      role,
      content,
      createdAt: Date.now(),
    });

    // Update cache
    const k = this.key(characterId, playerId);
    const cached = this.cache.get(k);
    if (cached) {
      cached.push(msg);
      // Keep cache bounded
      if (cached.length > 50) {
        cached.splice(0, cached.length - 50);
      }
    }

    return msg;
  }

  /**
   * Get recent chat messages.
   */
  getRecent(characterId: string, playerId: string, limit: number = 20): ChatMessage[] {
    const k = this.key(characterId, playerId);

    if (!this.cache.has(k)) {
      const messages = this.repo.getMessages(characterId, playerId, limit);
      this.cache.set(k, messages);
    }

    const cached = this.cache.get(k)!;
    return cached.slice(-limit);
  }

  /**
   * Clear cache for a conversation.
   */
  clearCache(characterId: string, playerId: string): void {
    this.cache.delete(this.key(characterId, playerId));
  }
}
