import type {
  EngineConfig,
  CharacterDefinition,
  CharacterState,
  GameEvent,
  AgentDecisionResult,
  AgentConversation,
  ChatMessage,
  DelegationOrder,
  ProximityScore,
  ActivityTier,
  CharacterGoal,
  GoalStep,
  CharacterRelationship,
  CharacterGroup,
  WorldFact,
  EmotionType,
  CharacterIntrospection,
  DecisionLogEntry,
  SnapshotInfo,
  TickConfig,
  ProximityConfig,
  CharacterDeathRecord,
  RoutineActivity,
  MemoryRecord,
  GossipItem,
  ReputationScores,
  HierarchyDefinition,
  HierarchyMembership,
  HierarchyOrder,
} from './types';
import { validateConfig, DEFAULT_MEMORY } from './config';
import { initLogger, getLogger } from './logger';
import { TypedEventEmitter, createEmitter } from './events';
import { MetricsCollector, type MetricsSnapshot } from './MetricsCollector';
import { initDatabase, closeDatabase, type DB } from '../db/database';

// Repositories
import { CharacterRepository } from '../db/repositories/CharacterRepository';
import { MemoryRepository } from '../db/repositories/MemoryRepository';
import { ProximityRepository } from '../db/repositories/ProximityRepository';
import { ChatRepository } from '../db/repositories/ChatRepository';
import { StateRepository } from '../db/repositories/StateRepository';
import { DecisionRepository } from '../db/repositories/DecisionRepository';
import type { DecisionQueryFilters } from '../db/repositories/DecisionRepository';

// Persistence
import { StatePersistence } from '../db/StatePersistence';

// Middleware
import { MiddlewarePipeline } from './Middleware';
import type { MiddlewareFn, MiddlewarePhase } from './Middleware';

// Memory
import { MemoryManager } from '../memory/MemoryManager';
import { createCompositeScorer } from '../memory/ImportanceScorer';
import { MemoryConsolidator } from '../memory/MemoryConsolidator';
import { SemanticRetriever } from '../memory/SemanticRetriever';

// Inference
import { InferenceService } from '../inference/InferenceService';
import { TokenBudget } from '../inference/TokenBudget';
import { EmbeddingService } from '../inference/EmbeddingService';
import { FailoverChain } from '../inference/FailoverChain';

// Agent
import { AgentRunner } from '../agent/AgentRunner';
import { AgentRegistry } from '../agent/AgentRegistry';
import { ToolExecutor } from '../agent/ToolExecutor';
import { ConversationManager } from '../agent/ConversationManager';
import { EmotionManager } from '../agent/EmotionManager';
import { RelationshipManager } from '../agent/RelationshipManager';
import { GoalPlanner } from '../agent/GoalPlanner';
import { WorldStateManager } from '../agent/WorldStateManager';
import { PlayerModeler } from '../agent/PlayerModeler';
import { GroupManager } from '../agent/GroupManager';
import { InitiativeChecker } from '../agent/InitiativeChecker';
import { PerceptionManager } from '../agent/PerceptionManager';
import { NeedsManager } from '../agent/NeedsManager';
import { RoutineManager } from '../agent/RoutineManager';
import { LifecycleManager } from '../agent/LifecycleManager';
import type { LifecycleSubsystems } from '../agent/LifecycleManager';
import { GossipManager } from '../agent/GossipManager';
import { ReputationManager } from '../agent/ReputationManager';
import { HierarchyManager } from '../agent/HierarchyManager';
import { MoodContagionManager } from '../agent/MoodContagionManager';
import { PromptExperiment, type ExperimentReport, type PromptVariantConfig } from '../agent/PromptExperiment';

// Tools
import { ToolRegistry } from '../tools/ToolRegistry';

// Proximity
import { ProximityManager } from '../proximity/ProximityManager';
import { DelegationManager } from '../proximity/DelegationManager';

// Scheduler
import { TickScheduler } from '../scheduler/TickScheduler';
import { AgentScheduler } from '../scheduler/AgentScheduler';
import { BatchProcessor } from '../scheduler/BatchProcessor';
import { ActivityTierManager } from '../scheduler/ActivityTierManager';
import { MultiPlayerManager } from '../scheduler/MultiPlayerManager';

// Chat
import { ChatService } from '../chat/ChatService';
import { ChatHistory } from '../chat/ChatHistory';
import { StreamingChatService } from '../chat/StreamingChatService';

// Plugin
import type { GamePlugin } from '../plugin/GamePlugin';
import { validatePlugin, loadPlugin } from '../plugin/PluginLoader';

/**
 * Engine - Top-level orchestrator.
 *
 * Wires together all subsystems and provides the public API
 * for games to interact with the AI character engine.
 */
export class Engine {
  // Core subsystem access
  public readonly events: TypedEventEmitter;
  public readonly tools: ToolRegistry;
  public readonly agents: AgentRegistry;
  public readonly memory: MemoryManager;
  public readonly inference: InferenceService;
  public readonly proximity: ProximityManager;
  public readonly delegation: DelegationManager;
  public readonly chat: ChatService;
  public readonly scheduler: TickScheduler;
  public readonly runner: AgentRunner;

  // Expansion subsystems
  public readonly conversations: ConversationManager;
  public readonly emotions: EmotionManager;
  public readonly relationships: RelationshipManager;
  public readonly goals: GoalPlanner;
  public readonly worldState: WorldStateManager;
  public readonly playerModeler: PlayerModeler;
  public readonly groups: GroupManager;
  public readonly multiPlayer: MultiPlayerManager;
  public readonly streamingChat: StreamingChatService;
  public readonly failoverChain: FailoverChain;
  public readonly consolidator: MemoryConsolidator;
  public readonly semanticRetriever?: SemanticRetriever;
  public readonly initiative: InitiativeChecker;
  public readonly perception: PerceptionManager;
  public readonly needs: NeedsManager;
  public readonly routines: RoutineManager;
  public readonly lifecycle: LifecycleManager;
  public readonly gossip: GossipManager;
  public readonly reputation: ReputationManager;
  public readonly hierarchy: HierarchyManager;
  public readonly moodContagion: MoodContagionManager;

  // New subsystems
  public readonly middleware: MiddlewarePipeline;
  public readonly persistence: StatePersistence;
  public readonly metrics: MetricsCollector;
  public readonly experiment: PromptExperiment;

  private config: EngineConfig;
  private db: DB;
  private plugin: GamePlugin | null = null;
  private log;
  private started = false;
  private stateRepo: StateRepository;
  private decisionRepo: DecisionRepository;

  // Auto-consolidation
  private consolidationCounter = 0;
  private static readonly CONSOLIDATION_INTERVAL = 10; // every 10 slow ticks (~5 min)
  private static readonly CONSOLIDATION_BATCH = 5;     // max chars per cycle

  constructor(rawConfig: unknown) {
    this.config = validateConfig(rawConfig);

    // Init logging
    initLogger(this.config.logging);
    this.log = getLogger('engine');

    // Init event emitter
    this.events = createEmitter();

    // Init database
    this.db = initDatabase(this.config.database.path);

    // Init repositories
    const charRepo = new CharacterRepository(this.db);
    const memRepo = new MemoryRepository(this.db);
    const proxRepo = new ProximityRepository(this.db);
    const chatRepo = new ChatRepository(this.db);
    this.stateRepo = new StateRepository(this.db);
    this.decisionRepo = new DecisionRepository(this.db);

    // Init metrics collector and A/B testing
    this.metrics = new MetricsCollector();
    this.experiment = new PromptExperiment();

    // Init middleware pipeline
    this.middleware = new MiddlewarePipeline();

    // Init tools
    this.tools = new ToolRegistry();

    // Init inference
    this.inference = new InferenceService(this.config.inference);
    const tokenBudget = new TokenBudget();

    // Init agents
    this.agents = new AgentRegistry(charRepo, proxRepo, this.events);

    // Init memory
    this.memory = new MemoryManager(
      memRepo,
      { ...DEFAULT_MEMORY, ...this.config.memory },
      this.events,
    );

    // Init proximity
    this.proximity = new ProximityManager(proxRepo, this.events, this.config.proximity);
    this.delegation = new DelegationManager(chatRepo, this.proximity);

    // Init agent runner
    const toolExecutor = new ToolExecutor(this.tools);
    this.runner = new AgentRunner(
      this.agents,
      this.memory,
      this.inference,
      toolExecutor,
      this.events,
      tokenBudget,
    );

    // Wire middleware and decision repo into runner
    this.runner.setMiddleware(this.middleware);
    this.runner.setDecisionRepo(this.decisionRepo);

    // Init expansion subsystems
    this.emotions = new EmotionManager();
    this.relationships = new RelationshipManager(this.db);
    this.goals = new GoalPlanner();
    this.worldState = new WorldStateManager();
    this.playerModeler = new PlayerModeler();
    this.groups = new GroupManager(this.agents);
    // Init embedding service (optional) and semantic retriever
    let embeddingService: EmbeddingService | undefined;
    if (this.config.embedding) {
      embeddingService = new EmbeddingService(this.config.embedding);
      this.log.info({ baseUrl: this.config.embedding.baseUrl }, 'Embedding service enabled');
    }

    this.consolidator = new MemoryConsolidator(memRepo, embeddingService);

    if (embeddingService) {
      (this as any).semanticRetriever = new SemanticRetriever(memRepo, embeddingService);
      this.runner.setSemanticRetriever(this.semanticRetriever!);
      this.log.info('Semantic retriever enabled');
    }

    this.perception = new PerceptionManager(this.agents);
    this.needs = new NeedsManager();
    this.routines = new RoutineManager();
    this.lifecycle = new LifecycleManager(this.agents, this.events);
    this.gossip = new GossipManager(this.perception, this.agents);
    this.reputation = new ReputationManager(this.perception, this.agents);
    this.hierarchy = new HierarchyManager(this.agents, this.relationships, this.reputation, this.events);
    this.moodContagion = new MoodContagionManager(this.perception, this.emotions, this.relationships);

    this.initiative = new InitiativeChecker(this.emotions, this.goals, this.relationships, this.needs);
    this.initiative.setHierarchy(this.hierarchy, this.agents);

    this.failoverChain = new FailoverChain();
    this.failoverChain.addProvider(this.config.inference);

    // Wire expansion subsystems into agent runner
    this.runner.setExpansions({
      emotions: this.emotions,
      relationships: this.relationships,
      goals: this.goals,
      worldState: this.worldState,
      groups: this.groups,
      playerModeler: this.playerModeler,
      needs: this.needs,
      routines: this.routines,
      perception: this.perception,
      gossip: this.gossip,
      reputation: this.reputation,
      hierarchy: this.hierarchy,
    });

    // Init state persistence and register all persistable managers
    this.persistence = new StatePersistence(this.stateRepo);
    this.persistence.register(this.emotions);
    this.persistence.register(this.relationships);
    this.persistence.register(this.goals);
    this.persistence.register(this.worldState);
    this.persistence.register(this.playerModeler);
    this.persistence.register(this.groups);
    this.persistence.register(this.multiPlayer = new MultiPlayerManager(this.agents, this.proximity, this.memory));
    this.persistence.register(this.runner);
    this.persistence.register(this.perception);
    this.persistence.register(this.needs);
    this.persistence.register(this.routines);
    this.persistence.register(this.lifecycle);
    this.persistence.register(this.gossip);
    this.persistence.register(this.reputation);
    this.persistence.register(this.hierarchy);
    // MoodContagion has no state — not registered

    // Init multi-agent conversations
    this.conversations = new ConversationManager(
      this.agents,
      this.memory,
      this.inference,
      this.events,
    );

    // Init scheduler
    const tierManager = new ActivityTierManager(this.agents, this.proximity);
    const agentScheduler = new AgentScheduler(tierManager, this.tools, null);
    const batchProcessor = new BatchProcessor(this.runner, this.config.tick.batchSize);

    this.scheduler = new TickScheduler(
      agentScheduler,
      batchProcessor,
      tierManager,
      this.proximity,
      this.memory,
      this.events,
      null,
      this.config.tick,
      this.inference,
      this.agents,
    );

    // Wire perception into scheduler
    this.scheduler.setPerception(this.perception);

    // Init chat
    const chatHistory = new ChatHistory(chatRepo);
    this.chat = new ChatService(
      chatHistory,
      this.agents,
      this.memory,
      this.inference,
      this.proximity,
      this.events,
    );

    // Wire middleware into chat service
    this.chat.setMiddleware(this.middleware);

    // Init streaming chat
    this.streamingChat = new StreamingChatService(
      chatHistory,
      this.agents,
      this.memory,
      this.proximity,
      this.events,
      this.config.inference,
    );

    // Sync character tier when proximity changes
    this.events.on('proximity:tierChanged', (characterId, oldTier, newTier) => {
      this.agents.update(characterId, { activityTier: newTier as any });
      // Plugin hook: onTierChanged
      this.plugin?.onTierChanged?.(characterId, oldTier as ActivityTier, newTier as ActivityTier);
    });

    // Sync closeness to character record on proximity changes
    this.events.on('proximity:changed', (score) => {
      this.agents.update(score.characterId, {
        closeness: score.closeness,
        highWaterMark: score.highWaterMark,
        activityTier: score.activityTier,
      });
    });

    // Decay emotions and grow needs on fast tick
    this.events.on('tick:fast', () => {
      this.emotions.decayAll();
      this.needs.growAll();
    });

    // Decay relationships and prune goals on slow tick
    // Also periodic state save, routine phase updates, perception, lifecycle
    this.events.on('tick:slow', () => {
      this.relationships.decayAll();
      this.goals.prune();
      this.gossip.expireOldGossip();
      this.reputation.decayAll();
      this.moodContagion.processContagion();
      this.hierarchy.expireOrders();

      // Update routine phase from game state
      if (this.plugin) {
        const gameState = this.plugin.getGameState();
        const phase = gameState.custom?.timePhase as string | undefined;
        if (phase) {
          const oldPhase = this.routines.getCurrentPhase();
          this.routines.updatePhase(phase);
          if (oldPhase && oldPhase !== phase) {
            this.events.emit('phase:changed', oldPhase, phase);
          }
        }

        // Update perception locations from plugin proprioception
        for (const char of this.agents.getAll()) {
          const proprio = this.plugin.getProprioception(char.id);
          if (proprio?.location) {
            this.perception.updateLocation(char.id, proprio.location);
          }
        }
      }

      // Process pending lifecycle respawns
      this.lifecycle.processPendingRespawns(this.plugin);

      // Auto-consolidation: fire-and-forget async
      this.consolidationCounter++;
      if (this.consolidationCounter >= Engine.CONSOLIDATION_INTERVAL) {
        this.consolidationCounter = 0;
        this.runAutoConsolidation().catch(err => {
          this.log.warn({ error: (err as Error).message }, 'Auto-consolidation failed');
        });
      }

      // Character initiative: check active-tier characters for self-initiated actions
      const activeChars = this.agents.getAll().filter(c => c.activityTier === 'active');
      const events = this.initiative.checkBatch(activeChars);
      for (const event of events) {
        this.scheduler.injectEvent(event).catch(() => {});
      }

      // Periodic state persistence
      try {
        this.persistence.saveAll();
      } catch (err) {
        this.log.warn({ error: (err as Error).message }, 'Periodic state save failed');
      }
    });

    // Track player interactions for modeling
    this.events.on('chat:message', (msg) => {
      if (msg.role === 'player') {
        this.playerModeler.recordInteraction(msg.playerId, 'chat');
      }
    });

    this.events.on('game:event', (event) => {
      if (event.source) {
        this.playerModeler.recordEvent('default', event);
      }

      // Handle character death events
      if (event.type === 'character_death') {
        this.lifecycle.processDeathEvent(event, this.plugin, this.getLifecycleSubsystems());
      }

      // Feed events into needs system for fulfillment
      const targetId = event.target ?? event.source;
      if (targetId) {
        this.needs.processEvent(targetId, event);
      }

      // Create gossip from high-importance events
      if (event.importance && event.importance >= 5) {
        const originId = event.source ?? event.target;
        if (originId) {
          const item = this.gossip.createFromEvent(event, originId);
          if (item && event.data?.location) {
            const witnesses = this.perception.getCharactersAtLocation(event.data.location as string);
            for (const wid of witnesses) this.gossip.addKnowledge(wid, item.id);
          }
        }
      }
    });

    // --- Metrics wiring ---
    this.events.on('agent:decision', (result) => {
      this.metrics.recordDecision(result.durationMs);
      this.metrics.recordTokens(result.tokensUsed);

      const action = result.action;
      if ('toolName' in action) {
        // ToolCall
        this.metrics.recordAction('tool');
        this.metrics.recordToolUse(action.toolName);
      } else {
        this.metrics.recordAction(action.type);
      }
    });

    this.log.info('Engine created');
  }

  /**
   * Load a game plugin into the engine.
   */
  async loadPlugin(plugin: GamePlugin): Promise<void> {
    const validated = validatePlugin(plugin);
    await loadPlugin(validated);
    this.plugin = validated;

    // Register plugin tools
    const tools = validated.getTools();
    for (const { definition, executor } of tools) {
      this.tools.register(definition, executor);
    }

    // Update scheduler references
    (this.scheduler as any).plugin = validated;
    ((this.scheduler as any).agentScheduler as AgentScheduler).setPlugin(validated);

    // Update memory importance scorer
    if (validated.scoreImportance) {
      const scorer = createCompositeScorer(validated.scoreImportance.bind(validated));
      (this.memory.episodic as any).importanceScorer = scorer;
    }

    // Wire plugin beforeDecision/afterDecision hooks via middleware
    if (validated.beforeDecision) {
      this.middleware.use('beforeDecision', async (ctx, next) => {
        const result = validated.beforeDecision!(ctx.characterId, ctx.request!);
        if (result === false) {
          ctx.abort = true;
          return;
        }
        await next();
      });
    }

    if (validated.afterDecision) {
      this.middleware.use('afterDecision', async (ctx, next) => {
        await next();
        if (ctx.result) {
          validated.afterDecision!(ctx.characterId, ctx.result);
        }
      });
    }

    // Register initial characters if plugin provides them
    const initialChars = validated.getInitialCharacters?.() ?? [];
    for (const def of initialChars) {
      if (!this.agents.get(def.id)) {
        this.agents.register(def);
        // Plugin hook: onCharacterAdded
        const charState = this.agents.get(def.id);
        if (charState) validated.onCharacterAdded?.(charState);
      }
    }

    // Load hierarchy definitions from plugin
    const hierarchyDefs = validated.getHierarchyDefinitions?.() ?? [];
    for (const def of hierarchyDefs) {
      this.hierarchy.defineFaction(def);
    }

    // Set lifecycle target population
    const targetPop = validated.getTargetPopulation?.() ?? initialChars.length;
    this.lifecycle.setTargetPopulation(targetPop);

    this.log.info({ pluginId: validated.id, tools: tools.length }, 'Plugin loaded');
  }

  /**
   * Start the engine (begins tick loops).
   * Auto-restores persisted state.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    // Persist any in-memory state set before start() (e.g., world facts, goals, groups)
    // then restore from DB — this merges pre-start setup with previously persisted state
    try {
      this.persistence.saveAll();
      this.persistence.loadAll();
      this.log.info('Persisted state saved and restored');
    } catch (err) {
      this.log.warn({ error: (err as Error).message }, 'State restore failed (starting fresh)');
    }

    this.scheduler.start();
    this.events.emit('engine:started');
    this.log.info('Engine started');
  }

  /**
   * Build the subsystems bundle for lifecycle operations.
   */
  private getLifecycleSubsystems(): LifecycleSubsystems {
    return {
      emotions: this.emotions,
      relationships: this.relationships,
      goals: this.goals,
      groups: this.groups,
      routines: this.routines,
      needs: this.needs,
      perception: this.perception,
      gossip: this.gossip,
      reputation: this.reputation,
      hierarchy: this.hierarchy,
      plugin: this.plugin,
      proximity: this.proximity,
      memory: this.memory,
      runner: this.runner,
      tools: this.tools,
    };
  }

  /**
   * Run memory consolidation for characters with enough episodic memories.
   * Fire-and-forget from slow tick — doesn't block the tick loop.
   */
  private async runAutoConsolidation(): Promise<void> {
    const allChars = this.agents.getAll();
    let count = 0;
    for (const char of allChars) {
      if (count >= Engine.CONSOLIDATION_BATCH || !this.started) break;
      const ctx = this.memory.getContext(char.id, 'default');
      if (ctx.episodicMemories.length >= 10) {
        await this.consolidator.consolidate(char.id, 'default');
        count++;
      }
    }
    if (count > 0) this.log.info({ consolidated: count }, 'Auto-consolidation completed');
  }

  /**
   * Stop the engine.
   * Auto-saves expansion state before shutdown.
   */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    // Signal runner to skip DB writes for in-flight decisions
    this.runner.shutdown();

    await this.scheduler.stop();

    // Auto-save expansion state before shutdown
    try {
      this.persistence.saveAll();
      this.log.info('State saved before shutdown');
    } catch (err) {
      this.log.warn({ error: (err as Error).message }, 'State save on shutdown failed');
    }

    if (this.plugin?.shutdown) {
      await this.plugin.shutdown();
    }

    closeDatabase();
    this.events.emit('engine:stopped');
    this.log.info('Engine stopped');
  }

  // --- Convenience API ---

  /**
   * Register a character.
   */
  registerCharacter(def: CharacterDefinition, playerId?: string): CharacterState {
    const state = this.agents.register(def, playerId);
    // Plugin hook: onCharacterAdded
    this.plugin?.onCharacterAdded?.(state);
    return state;
  }

  /**
   * Get a character by ID.
   */
  getCharacter(id: string): CharacterState | null {
    return this.agents.get(id);
  }

  /**
   * Get all characters.
   */
  getAllCharacters(): CharacterState[] {
    return this.agents.getAll();
  }

  /**
   * Send a chat message to a character.
   */
  async chatWith(characterId: string, message: string, playerId?: string): Promise<ChatMessage> {
    return this.chat.sendMessage(characterId, playerId ?? 'default', message);
  }

  /**
   * Delegate an instruction to a character.
   */
  delegateTo(characterId: string, instruction: string, scope: string, playerId?: string): DelegationOrder {
    return this.delegation.delegate(characterId, playerId ?? 'default', instruction, scope);
  }

  /**
   * Inject a game event into the engine.
   */
  async injectEvent(event: GameEvent, playerId?: string): Promise<void> {
    return this.scheduler.injectEvent(event, playerId);
  }

  /**
   * Get proximity score for a character.
   */
  getCloseness(characterId: string, playerId?: string): ProximityScore | null {
    return this.proximity.getScore(characterId, playerId ?? 'default');
  }

  /**
   * Manually boost a character's closeness.
   */
  boostCloseness(characterId: string, amount: number, playerId?: string): ProximityScore {
    return this.proximity.boostFromEvent(characterId, playerId ?? 'default', amount);
  }

  /**
   * Check if the inference provider is available.
   */
  async healthCheck(): Promise<{ inference: boolean; database: boolean }> {
    const inference = await this.inference.healthCheck();
    return { inference, database: true };
  }

  /**
   * Get engine statistics.
   */
  getStats(): {
    characters: Record<ActivityTier, number>;
    inference: { totalRequests: number; totalTokens: number; provider: string };
    scheduler: { fastTicks: number; slowTicks: number; running: boolean };
  } {
    const all = this.agents.getAll();
    const characters = { active: 0, background: 0, dormant: 0 };
    for (const c of all) {
      characters[c.activityTier]++;
    }

    return {
      characters,
      inference: this.inference.getStats(),
      scheduler: this.scheduler.stats,
    };
  }

  // --- Expansion Convenience API ---

  /**
   * Start a conversation between characters.
   */
  async startConversation(
    participantIds: string[],
    topic: string,
    maxTurns?: number,
  ): Promise<AgentConversation> {
    return this.conversations.startConversation(participantIds, topic, maxTurns);
  }

  /**
   * Run a full conversation to completion.
   */
  async runConversation(conversationId: string): Promise<AgentConversation> {
    return this.conversations.runFull(conversationId);
  }

  /**
   * Apply an emotion to a character.
   */
  applyEmotion(characterId: string, emotion: EmotionType, intensity: number): void {
    this.emotions.applyEmotion(characterId, emotion, intensity);
  }

  /**
   * Set a relationship between two characters.
   */
  setRelationship(
    fromId: string,
    toId: string,
    changes: Partial<Pick<CharacterRelationship, 'type' | 'strength' | 'trust'>>,
  ): CharacterRelationship {
    return this.relationships.update(fromId, toId, changes);
  }

  /**
   * Add a goal for a character.
   */
  addGoal(
    characterId: string,
    description: string,
    priority?: number,
    steps?: GoalStep[],
  ): CharacterGoal {
    return this.goals.addGoal(characterId, description, priority, steps);
  }

  /**
   * Set a world state fact.
   */
  setWorldFact(key: string, value: unknown, category: string, source: string): void {
    this.worldState.set(key, value, category, source);
  }

  /**
   * Get a world state fact value.
   */
  getWorldFact<T = unknown>(key: string): T | undefined {
    return this.worldState.getValue<T>(key);
  }

  /**
   * Create a character group.
   */
  createGroup(name: string, memberIds: string[], purpose: string): CharacterGroup {
    return this.groups.createGroup(name, memberIds, purpose);
  }

  /**
   * Register a player for multi-player mode.
   */
  joinPlayer(playerId: string): void {
    this.multiPlayer.joinPlayer(playerId);
  }

  /**
   * Remove a player from multi-player mode.
   */
  leavePlayer(playerId: string): void {
    this.multiPlayer.leavePlayer(playerId);
  }

  /**
   * Add a failover provider.
   */
  addFailoverProvider(config: EngineConfig['inference']): void {
    this.failoverChain.addProvider(config);
  }

  /**
   * Consolidate similar memories for a character.
   */
  async consolidateMemories(characterId: string, playerId?: string): Promise<void> {
    await this.consolidator.consolidate(characterId, playerId ?? 'default');
  }

  /**
   * Stream a chat response.
   */
  streamChatWith(
    characterId: string,
    message: string,
    playerId?: string,
  ): AsyncGenerator<string, void, unknown> {
    return this.streamingChat.streamMessage(characterId, playerId ?? 'default', message);
  }

  /**
   * Stream an inference completion. Yields content chunks as they arrive.
   * Useful for real-time UIs that want to show reasoning tokens.
   */
  async *streamInference(request: import('./types').InferenceRequest): AsyncGenerator<string, import('./types').InferenceResponse> {
    return yield* this.inference.streamComplete(request);
  }

  // --- Phase 1: State Persistence API ---

  /**
   * Manually persist all expansion state to DB.
   */
  persistState(): void {
    this.persistence.saveAll();
  }

  /**
   * Save a named snapshot of all expansion state.
   */
  saveSnapshot(name?: string): string {
    return this.persistence.saveSnapshot(name);
  }

  /**
   * List all saved snapshots.
   */
  listSnapshots(): SnapshotInfo[] {
    return this.persistence.listSnapshots();
  }

  /**
   * Export all expansion state as a JSON-serializable object.
   */
  exportState(): Record<string, unknown> {
    return this.persistence.exportState();
  }

  /**
   * Import state from an exported JSON object.
   */
  importState(data: Record<string, unknown>): void {
    this.persistence.importState(data);
  }

  // --- Phase 5: Character Introspection ---

  /**
   * Get a complete introspection of a character's current state.
   * Aggregates data from all subsystems in one call.
   */
  getCharacterIntrospection(characterId: string, playerId?: string): CharacterIntrospection | null {
    const character = this.agents.get(characterId);
    if (!character) return null;

    const pid = playerId ?? 'default';
    const memCtx = this.memory.getContext(characterId, pid);

    return {
      character,
      proximity: this.proximity.getScore(characterId, pid),
      emotions: this.emotions.getEmotions(characterId),
      relationships: this.relationships.getRelationships(characterId),
      goals: this.goals.getAllGoals(characterId),
      recentMemories: memCtx.episodicMemories,
      summary: memCtx.characterSummary,
      groups: this.groups.getCharacterGroups(characterId),
      workingMemory: memCtx.workingMemory,
      routine: this.routines.getCurrentActivity(characterId),
      needs: this.needs.getNeeds(characterId),
      nearbyCharacters: this.perception.getCharactersAtLocation(
        this.perception.getLocation(characterId) ?? '',
      ).filter(id => id !== characterId),
      gossipKnown: this.gossip.getKnownGossip(characterId),
      reputation: this.reputation.getReputation(characterId),
      hierarchy: this.hierarchy.getCharacterFactions(characterId),
    };
  }

  // --- Phase 5: Decision Log Queries ---

  /**
   * Query the decision log.
   */
  queryDecisions(filters?: DecisionQueryFilters): DecisionLogEntry[] {
    return this.decisionRepo.query(filters);
  }

  /**
   * Count decisions matching filters.
   */
  countDecisions(filters?: DecisionQueryFilters): number {
    return this.decisionRepo.count(filters);
  }

  // --- Phase 6: Runtime Config Updates ---

  /**
   * Update engine configuration at runtime.
   * Supports tick rates, batch sizes, and proximity thresholds.
   */
  updateConfig(updates: {
    tick?: Partial<TickConfig>;
    proximity?: Partial<ProximityConfig>;
  }): void {
    if (updates.tick) {
      this.scheduler.updateConfig(updates.tick);
      this.log.info({ tick: updates.tick }, 'Tick config updated');
    }
    if (updates.proximity) {
      this.proximity.updateConfig(updates.proximity);
      this.log.info({ proximity: updates.proximity }, 'Proximity config updated');
    }
  }

  // --- Lifecycle Convenience API ---

  /**
   * Kill a character by ID.
   */
  killCharacter(characterId: string, cause: string): CharacterDeathRecord | null {
    return this.lifecycle.killCharacter(characterId, cause, this.getLifecycleSubsystems());
  }

  /**
   * Get all death records.
   */
  getDeathRecords(): CharacterDeathRecord[] {
    return this.lifecycle.getDeathRecords();
  }

  // --- Trauma Memory API ---

  /**
   * Create a permanent trauma memory that never decays.
   * Use for devastating events that should haunt the character forever.
   */
  recordTrauma(
    characterId: string,
    content: string,
    summary: string,
    tags?: string[],
    playerId: string = 'default',
  ): MemoryRecord {
    return this.memory.recordTrauma(characterId, playerId, content, summary, tags);
  }

  // --- Routine Convenience API ---

  /**
   * Add a routine for a character.
   */
  addRoutine(
    characterId: string,
    name: string,
    activities: RoutineActivity[],
    conditions?: Record<string, unknown>,
    isDefault?: boolean,
  ) {
    return this.routines.addRoutine(characterId, name, activities, conditions, isDefault);
  }

  // --- Gossip & Reputation Convenience API ---

  /**
   * Get all gossip a character knows.
   */
  getCharacterGossip(characterId: string): GossipItem[] {
    return this.gossip.getKnownGossip(characterId);
  }

  /**
   * Change a character's reputation.
   */
  changeReputation(characterId: string, dimension: string, delta: number, reason: string): void {
    this.reputation.changeReputation(characterId, dimension, delta, reason, [], this.gossip);
  }

  /**
   * Register custom reputation dimensions from the game.
   */
  registerReputationDimensions(dimensions: string[]): void {
    this.reputation.registerDimensions(dimensions);
  }

  // --- Hierarchy Convenience API ---

  /**
   * Define a faction with ranks.
   */
  defineHierarchy(def: HierarchyDefinition): void {
    this.hierarchy.defineFaction(def);
  }

  /**
   * Set a character's rank in a faction.
   */
  setCharacterRank(characterId: string, factionId: string, rankLevel: number): void {
    this.hierarchy.setRank(characterId, factionId, rankLevel);
  }

  /**
   * Promote a character one rank up in a faction.
   */
  promoteCharacter(characterId: string, factionId: string): boolean {
    return this.hierarchy.promote(characterId, factionId);
  }

  /**
   * Demote a character one rank down in a faction.
   */
  demoteCharacter(characterId: string, factionId: string): boolean {
    return this.hierarchy.demote(characterId, factionId);
  }

  /**
   * Get subordinates of a character in a faction.
   */
  getSubordinates(characterId: string, factionId: string): HierarchyMembership[] {
    return this.hierarchy.getSubordinates(characterId, factionId);
  }

  /**
   * Get superiors of a character in a faction.
   */
  getSuperiors(characterId: string, factionId: string): HierarchyMembership[] {
    return this.hierarchy.getSuperiors(characterId, factionId);
  }

  /**
   * Get all members of a faction.
   */
  getFactionMembers(factionId: string): HierarchyMembership[] {
    return this.hierarchy.getFactionMembers(factionId);
  }

  /**
   * Get promotion candidates for a rank in a faction, sorted by score.
   */
  getPromotionCandidates(factionId: string, targetRank: number): Array<{ characterId: string; score: number }> {
    return this.hierarchy.getPromotionCandidates(factionId, targetRank);
  }

  /**
   * Issue an order from a superior to a subordinate in a faction.
   */
  issueHierarchyOrder(from: string, to: string, factionId: string, instruction: string, scope: string): HierarchyOrder | null {
    return this.hierarchy.issueOrder(from, to, factionId, instruction, scope);
  }
}
