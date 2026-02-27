import type {
  AgentConversation,
  ConversationTurn,
  CharacterState,
  InferenceMessage,
} from '../core/types';
import { ContextAssembler } from './ContextAssembler';
import { AgentRegistry } from './AgentRegistry';
import { MemoryManager } from '../memory/MemoryManager';
import { InferenceService } from '../inference/InferenceService';
import { TypedEventEmitter } from '../core/events';
import { getLogger } from '../core/logger';

/**
 * Expansion 4: Multi-Agent Conversations
 *
 * Manages character-to-character dialogue. Characters take turns
 * speaking, each using their own personality and memory context.
 */
export class ConversationManager {
  private conversations = new Map<string, AgentConversation>();
  private contextAssembler = new ContextAssembler();
  private log = getLogger('conversation-manager');

  constructor(
    private registry: AgentRegistry,
    private memory: MemoryManager,
    private inference: InferenceService,
    private emitter: TypedEventEmitter,
  ) {}

  /**
   * Start a conversation between characters.
   */
  async startConversation(
    participantIds: string[],
    topic: string,
    maxTurns: number = 6,
  ): Promise<AgentConversation> {
    const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const conversation: AgentConversation = {
      id,
      participantIds,
      topic,
      turns: [],
      maxTurns,
      status: 'active',
      startedAt: Date.now(),
    };

    this.conversations.set(id, conversation);
    this.log.info({ id, participants: participantIds, topic }, 'Conversation started');

    return conversation;
  }

  /**
   * Run one full round of a conversation (each participant speaks once).
   */
  async runRound(conversationId: string): Promise<ConversationTurn[]> {
    const conv = this.conversations.get(conversationId);
    if (!conv || conv.status !== 'active') return [];

    const roundTurns: ConversationTurn[] = [];

    for (const charId of conv.participantIds) {
      if (conv.turns.length >= conv.maxTurns) {
        conv.status = 'completed';
        conv.completedAt = Date.now();
        break;
      }

      const character = this.registry.get(charId);
      if (!character) continue;

      const response = await this.generateTurn(character, conv);
      const turn: ConversationTurn = {
        characterId: charId,
        content: response,
        timestamp: Date.now(),
      };

      conv.turns.push(turn);
      roundTurns.push(turn);

      // Record to memory for both participants
      for (const otherId of conv.participantIds) {
        if (otherId !== charId) {
          this.memory.addWorkingMemory(
            otherId, 'default', 'user',
            `${character.name} said: "${response.slice(0, 150)}"`,
          );
        }
      }

      this.memory.addWorkingMemory(charId, 'default', 'assistant', response);
    }

    this.emitter.emit('game:event', {
      type: 'conversation_round',
      source: conversationId,
      data: { turns: roundTurns.length, topic: conv.topic },
      importance: 4,
      timestamp: Date.now(),
    });

    return roundTurns;
  }

  /**
   * Run a full conversation to completion.
   */
  async runFull(conversationId: string): Promise<AgentConversation> {
    const conv = this.conversations.get(conversationId);
    if (!conv) throw new Error(`Conversation not found: ${conversationId}`);

    while (conv.status === 'active') {
      await this.runRound(conversationId);
    }

    // Record significant conversation as episodic memory for participants
    const summary = this.summarizeConversation(conv);
    for (const charId of conv.participantIds) {
      this.memory.recordEvent(
        charId, 'default',
        {
          type: 'multi_agent_conversation',
          source: conversationId,
          data: { topic: conv.topic, participants: conv.participantIds },
          importance: 5,
          timestamp: Date.now(),
        },
        summary,
        `Conversation about: ${conv.topic}`,
        ['conversation', 'social'],
      );
    }

    return conv;
  }

  /**
   * Get an active conversation.
   */
  get(id: string): AgentConversation | undefined {
    return this.conversations.get(id);
  }

  /**
   * Get all active conversations.
   */
  getActive(): AgentConversation[] {
    return [...this.conversations.values()].filter(c => c.status === 'active');
  }

  private async generateTurn(
    character: CharacterState,
    conversation: AgentConversation,
  ): Promise<string> {
    const memContext = this.memory.getContext(character.id, 'default');
    const otherNames = conversation.participantIds
      .filter(id => id !== character.id)
      .map(id => this.registry.get(id)?.name ?? id);

    const messages: InferenceMessage[] = [];

    // System prompt
    messages.push({
      role: 'system',
      content: this.buildConversationSystemPrompt(character, otherNames, conversation.topic),
    });

    // Key memories
    if (memContext.episodicMemories.length > 0) {
      const memBlock = memContext.episodicMemories
        .slice(0, 3)
        .map(m => `- ${m.summary}`)
        .join('\n');
      messages.push({ role: 'user', content: `Your relevant memories:\n${memBlock}` });
      messages.push({ role: 'assistant', content: 'I recall these.' });
    }

    // Conversation history
    for (const turn of conversation.turns.slice(-6)) {
      const speaker = this.registry.get(turn.characterId);
      const name = speaker?.name ?? turn.characterId;
      if (turn.characterId === character.id) {
        messages.push({ role: 'assistant', content: turn.content });
      } else {
        messages.push({ role: 'user', content: `${name}: ${turn.content}` });
      }
    }

    // Prompt for next turn
    if (conversation.turns.length === 0) {
      messages.push({
        role: 'user',
        content: `Topic of conversation: ${conversation.topic}\nYou're speaking with ${otherNames.join(' and ')}. Start the conversation.`,
      });
    } else {
      const lastTurn = conversation.turns[conversation.turns.length - 1];
      if (lastTurn.characterId !== character.id) {
        messages.push({
          role: 'user',
          content: `Respond naturally to what was said. Stay in character.`,
        });
      }
    }

    const response = await this.inference.complete({
      messages,
      tier: 'mid',
      maxTokens: 200,
      temperature: 0.8,
      characterId: character.id,
    });

    return response.content.trim();
  }

  private buildConversationSystemPrompt(
    character: CharacterState,
    otherNames: string[],
    topic: string,
  ): string {
    const parts = [
      `You are ${character.name}, a ${character.archetype}.`,
      `Personality: ${character.identity.personality}`,
    ];

    if (character.identity.traits.length > 0) {
      parts.push(`Traits: ${character.identity.traits.join(', ')}`);
    }
    if (character.identity.speechStyle) {
      parts.push(`Speech style: ${character.identity.speechStyle}`);
    }

    parts.push(`\nYou're in a conversation with ${otherNames.join(' and ')} about: ${topic}`);
    parts.push(`Stay in character. Be natural and concise. Respond with dialogue only - no actions or narration.`);

    return parts.join('\n');
  }

  private summarizeConversation(conv: AgentConversation): string {
    const speakers = conv.turns.map(t => {
      const char = this.registry.get(t.characterId);
      return `${char?.name ?? t.characterId}: "${t.content.slice(0, 80)}"`;
    });
    return `Conversation about "${conv.topic}": ${speakers.join(' | ')}`;
  }
}
