import type { CharacterState, GameEvent } from '../core/types';
import type { EmotionManager } from './EmotionManager';
import type { GoalPlanner } from './GoalPlanner';
import type { RelationshipManager } from './RelationshipManager';
import type { NeedsManager } from './NeedsManager';
import type { HierarchyManager } from './HierarchyManager';
import type { AgentRegistry } from './AgentRegistry';

export interface InitiativeConfig {
  enabled: boolean;
  maxPerCycle: number;          // default 2
  emotionThreshold: number;     // default 0.5
  relationshipThreshold: number; // default 70
  needsThreshold: number;       // default 0.7
}

/**
 * Checks active-tier characters for conditions that warrant self-initiated action.
 * Generates `character_initiative` GameEvents injected into the tick scheduler.
 */
export class InitiativeChecker {
  private config: InitiativeConfig = {
    enabled: true,
    maxPerCycle: 2,
    emotionThreshold: 0.5,
    relationshipThreshold: 70,
    needsThreshold: 0.7,
  };

  // Queue of overflow events from previous cycles
  private pendingEvents: GameEvent[] = [];

  private hierarchy?: HierarchyManager;
  private agentRegistry?: AgentRegistry;

  constructor(
    private emotions: EmotionManager,
    private goals: GoalPlanner,
    private relationships: RelationshipManager,
    private needs?: NeedsManager,
  ) {}

  setHierarchy(hierarchy: HierarchyManager, registry: AgentRegistry): void {
    this.hierarchy = hierarchy;
    this.agentRegistry = registry;
  }

  /**
   * Check a single character for initiative triggers.
   * Returns a GameEvent if a trigger is found, null otherwise.
   */
  check(character: CharacterState): GameEvent | null {
    if (!this.config.enabled) return null;

    const now = Date.now();

    // 0. Active hierarchy orders → order-driven initiative
    if (this.hierarchy) {
      const activeOrders = this.hierarchy.getActiveOrders(character.id);
      if (activeOrders.length > 0) {
        const order = activeOrders[0]; // Act on first active order
        const fromChar = this.agentRegistry?.get(order.fromCharacterId);
        const fromName = fromChar?.name ?? order.fromCharacterId;
        return {
          type: 'character_initiative',
          source: character.id,
          data: {
            reason: 'hierarchy_order',
            detail: `Ordered by ${fromName} to ${order.instruction}`,
            orderId: order.id,
          },
          importance: 7,
          timestamp: now,
        };
      }
    }

    // 1. Strong emotion → emotional initiative
    const emo = this.emotions.getEmotions(character.id);
    const dominant = emo.active.length > 0
      ? emo.active.reduce((max, e) => e.intensity > max.intensity ? e : max)
      : null;
    if (dominant && dominant.intensity > this.config.emotionThreshold) {
      return {
        type: 'character_initiative',
        source: character.id,
        data: {
          reason: 'emotional_response',
          detail: `Feeling strong ${dominant.type} (${dominant.intensity.toFixed(2)})`,
          emotion: dominant.type,
        },
        importance: Math.round(dominant.intensity * 8),
        timestamp: now,
      };
    }

    // 2. Critical need → need-driven initiative
    if (this.needs) {
      const critical = this.needs.getCriticalNeeds(character.id, this.config.needsThreshold);
      if (critical.length > 0) {
        const worst = critical.reduce((max, n) => n.intensity > max.intensity ? n : max);
        return {
          type: 'character_initiative',
          source: character.id,
          data: {
            reason: 'critical_need',
            detail: `Desperately needs ${worst.type} (${worst.intensity.toFixed(2)})`,
            needType: worst.type,
          },
          importance: Math.round(worst.intensity * 8),
          timestamp: now,
        };
      }
    }

    // 3. Active goal with a tool hint on the next step → goal pursuit
    const activeGoals = this.goals.getActiveGoals(character.id);
    for (const goal of activeGoals) {
      if (goal.status !== 'active') continue;
      const nextStep = goal.steps.find(s => !s.completed);
      if (nextStep?.toolName) {
        return {
          type: 'character_initiative',
          source: character.id,
          data: {
            reason: 'pursuing_goal',
            detail: `Pursuing "${goal.description}" — next: ${nextStep.description}`,
            goalId: goal.id,
            toolHint: nextStep.toolName,
          },
          importance: Math.min(9, goal.priority + 2),
          timestamp: now,
        };
      }
    }

    // 4. Strong relationship → social initiative
    const rels = this.relationships.getRelationships(character.id)
      .filter(r => r.fromId === character.id && r.strength >= this.config.relationshipThreshold);
    if (rels.length > 0) {
      const strongest = rels.reduce((max, r) => r.strength > max.strength ? r : max);
      return {
        type: 'character_initiative',
        source: character.id,
        target: strongest.toId,
        data: {
          reason: 'social_initiative',
          detail: `Wants to interact with ${strongest.toId} (${strongest.type}, strength ${Math.round(strongest.strength)})`,
        },
        importance: 5,
        timestamp: now,
      };
    }

    return null;
  }

  /**
   * Check a batch of characters. Returns up to maxPerCycle events.
   * Overflow events are queued and emitted in subsequent cycles.
   */
  checkBatch(characters: CharacterState[]): GameEvent[] {
    if (!this.config.enabled) return [];

    // Drain pending events from previous cycles first
    const events: GameEvent[] = [];
    while (this.pendingEvents.length > 0 && events.length < this.config.maxPerCycle) {
      events.push(this.pendingEvents.shift()!);
    }

    for (const char of characters) {
      const event = this.check(char);
      if (!event) continue;

      if (events.length < this.config.maxPerCycle) {
        events.push(event);
      } else {
        // Queue overflow for next cycle (cap queue to prevent unbounded growth)
        if (this.pendingEvents.length < this.config.maxPerCycle * 5) {
          this.pendingEvents.push(event);
        }
      }
    }
    return events;
  }

  /**
   * Update initiative configuration at runtime.
   */
  updateConfig(updates: Partial<InitiativeConfig>): void {
    Object.assign(this.config, updates);
  }
}
