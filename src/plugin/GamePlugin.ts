import type {
  ToolDefinition,
  ToolResult,
  GameState,
  CharacterProprioception,
  GameEvent,
  CharacterDefinition,
  CharacterState,
  ActivityTier,
  AgentDecisionRequest,
  AgentDecisionResult,
  HierarchyDefinition,
} from '../core/types';
import type { ToolExecutorFn } from '../tools/ToolRegistry';

/**
 * GamePlugin is the interface that games implement to plug into the engine.
 * It provides game-specific tools, state, and event handling.
 */
export interface GamePlugin {
  /** Unique identifier for this game plugin */
  id: string;

  /** Human-readable name */
  name: string;

  /** Called when the plugin is loaded. Set up state, register tools, etc. */
  initialize?(): Promise<void> | void;

  /** Called when the plugin is unloaded */
  shutdown?(): Promise<void> | void;

  /** Return character archetypes available in this game */
  getArchetypes(): ArchetypeDefinition[];

  /** Return initial character definitions for this game (optional) */
  getInitialCharacters?(): CharacterDefinition[];

  /** Return tool definitions and their executors */
  getTools(): Array<{ definition: ToolDefinition; executor: ToolExecutorFn }>;

  /** Get the current global game state snapshot */
  getGameState(): GameState;

  /** Get a specific character's proprioception (self-knowledge) */
  getProprioception(characterId: string): CharacterProprioception;

  /**
   * Score the importance of an event for a specific character (1-10).
   * Return undefined to use default scoring.
   */
  scoreImportance?(characterId: string, event: GameEvent): number | undefined;

  /** Return game-specific world rules to include in system prompts */
  getWorldRules?(): string;

  /** Return the event types this game generates */
  getEventTypes?(): string[];

  /** Called when a character makes a decision (for game-side effects) */
  onCharacterAction?(characterId: string, action: string, args: Record<string, unknown>): void;

  /** Called every slow tick */
  onSlowTick?(timestamp: number): void;

  /** Called every fast tick */
  onFastTick?(timestamp: number): void;

  // --- Phase 4: Lifecycle Hooks ---

  /** Called when a character is registered in the engine */
  onCharacterAdded?(character: CharacterState): void;

  /** Called when a character is removed from the engine */
  onCharacterRemoved?(characterId: string): void;

  /** Called when a character's activity tier changes */
  onTierChanged?(characterId: string, oldTier: ActivityTier, newTier: ActivityTier): void;

  /** Called before a decision — return false to skip this character's decision */
  beforeDecision?(characterId: string, request: AgentDecisionRequest): boolean | void;

  /** Called after a decision completes */
  afterDecision?(characterId: string, result: AgentDecisionResult): void;

  /** Called to filter events — return false to suppress the event for this character */
  filterEvent?(characterId: string, event: GameEvent): boolean;

  /** Provide a replacement character when one dies. Return null for engine fallback. */
  spawnReplacement?(diedCharId: string): CharacterDefinition | null;

  /** Target population for auto-respawn. Defaults to initial character count. */
  getTargetPopulation?(): number;

  // --- Expansion 38: Hierarchy Hooks ---

  /** Return hierarchy definitions (factions + ranks) for this game. */
  getHierarchyDefinitions?(): HierarchyDefinition[];

  /** Called when a leader vacates a rank. Return a characterId to promote, or null for engine fallback. */
  onSuccession?(factionId: string, vacatedRank: number, candidates: Array<{ characterId: string; score: number }>): string | null;
}

export interface ArchetypeDefinition {
  id: string;
  name: string;
  description: string;
  defaultIdentity: {
    personality: string;
    backstory: string;
    goals: string[];
    traits: string[];
  };
}
