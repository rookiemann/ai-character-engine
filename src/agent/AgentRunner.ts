import type {
  AgentDecisionRequest,
  AgentDecisionResult,
  CharacterState,
  GameEvent,
  InferenceRequest,
  ToolCall,
  DialogueAction,
  IdleAction,
  InferenceTier,
  Persistable,
  ToolExecutionContext,
  DecisionLogEntry,
} from '../core/types';
import type { MiddlewarePipeline, MiddlewareContext } from '../core/Middleware';
import { ContextAssembler } from './ContextAssembler';
import { ToolExecutor } from './ToolExecutor';
import { AgentRegistry } from './AgentRegistry';
import type { EmotionManager } from './EmotionManager';
import type { RelationshipManager } from './RelationshipManager';
import type { GoalPlanner } from './GoalPlanner';
import type { WorldStateManager } from './WorldStateManager';
import type { GroupManager } from './GroupManager';
import type { PlayerModeler } from './PlayerModeler';
import type { NeedsManager } from './NeedsManager';
import type { RoutineManager } from './RoutineManager';
import type { PerceptionManager } from './PerceptionManager';
import type { GossipManager } from './GossipManager';
import type { ReputationManager } from './ReputationManager';
import type { HierarchyManager } from './HierarchyManager';
import type { PromptExtensions } from './PromptBuilder';
import type { DecisionRepository } from '../db/repositories/DecisionRepository';
import type { StateRepository } from '../db/repositories/StateRepository';
import type { SemanticRetriever } from '../memory/SemanticRetriever';
import { MemoryManager } from '../memory/MemoryManager';
import { InferenceService } from '../inference/InferenceService';
import { TokenBudget } from '../inference/TokenBudget';
import { TypedEventEmitter } from '../core/events';
import { AgentError } from '../core/errors';
import { getLogger } from '../core/logger';

/**
 * AgentRunner - The single decision cycle executor.
 *
 * Each agent decision = single stateless LLM call:
 * context → LLM → tool call or dialogue → memory → proximity boost
 *
 * This is the heart of the engine.
 */
export class AgentRunner implements Persistable {
  private contextAssembler: ContextAssembler;
  private tokenBudget: TokenBudget;
  private log = getLogger('agent-runner');

  // Recency tracking: last N actions per character to avoid repetition
  private recentActions = new Map<string, string[]>();
  private static MAX_RECENT = 5;

  // Tool rotation: round-robin index per character for tool variety
  private toolRotation = new Map<string, number>();

  // Shutdown flag: skip DB writes when engine is stopping
  private stopped = false;

  // Expansion subsystem references (optional, set via setExpansions)
  private emotions?: EmotionManager;
  private relationships?: RelationshipManager;
  private goals?: GoalPlanner;
  private worldState?: WorldStateManager;
  private groups?: GroupManager;
  private playerModeler?: PlayerModeler;
  private needs?: NeedsManager;
  private routines?: RoutineManager;
  private perception?: PerceptionManager;
  private gossip?: GossipManager;
  private reputation?: ReputationManager;
  private hierarchy?: HierarchyManager;

  // Middleware pipeline (optional, set via setMiddleware)
  private middleware?: MiddlewarePipeline;

  // Decision logging (optional, set via setDecisionRepo)
  private decisionRepo?: DecisionRepository;

  // Semantic memory retriever (optional, set via setSemanticRetriever)
  private semanticRetriever?: SemanticRetriever;

  constructor(
    private registry: AgentRegistry,
    private memory: MemoryManager,
    private inference: InferenceService,
    private toolExecutor: ToolExecutor,
    private emitter: TypedEventEmitter,
    tokenBudget?: TokenBudget,
  ) {
    this.tokenBudget = tokenBudget ?? new TokenBudget();
    this.contextAssembler = new ContextAssembler(this.tokenBudget);
  }

  /**
   * Attach expansion subsystems for prompt enrichment.
   */
  setExpansions(expansions: {
    emotions?: EmotionManager;
    relationships?: RelationshipManager;
    goals?: GoalPlanner;
    worldState?: WorldStateManager;
    groups?: GroupManager;
    playerModeler?: PlayerModeler;
    needs?: NeedsManager;
    routines?: RoutineManager;
    perception?: PerceptionManager;
    gossip?: GossipManager;
    reputation?: ReputationManager;
    hierarchy?: HierarchyManager;
  }): void {
    this.emotions = expansions.emotions;
    this.relationships = expansions.relationships;
    this.goals = expansions.goals;
    this.worldState = expansions.worldState;
    this.groups = expansions.groups;
    this.playerModeler = expansions.playerModeler;
    this.needs = expansions.needs;
    this.routines = expansions.routines;
    this.perception = expansions.perception;
    this.gossip = expansions.gossip;
    this.reputation = expansions.reputation;
    this.hierarchy = expansions.hierarchy;
  }

  /**
   * Attach middleware pipeline for before/after hooks.
   */
  setMiddleware(pipeline: MiddlewarePipeline): void {
    this.middleware = pipeline;
  }

  /**
   * Attach decision repository for logging.
   */
  setDecisionRepo(repo: DecisionRepository): void {
    this.decisionRepo = repo;
  }

  /**
   * Attach semantic retriever for embedding-based memory augmentation.
   */
  setSemanticRetriever(retriever: SemanticRetriever): void {
    this.semanticRetriever = retriever;
  }

  /**
   * Signal that the engine is shutting down. Skips DB writes for in-flight decisions.
   */
  shutdown(): void {
    this.stopped = true;
  }

  /**
   * Clean up in-memory state for a removed character.
   * Called by LifecycleManager on death to prevent memory leaks.
   */
  clearCharacter(characterId: string): void {
    this.recentActions.delete(characterId);
    this.toolRotation.delete(characterId);
  }

  /**
   * Execute a single agent decision cycle.
   */
  async runDecision(request: AgentDecisionRequest): Promise<AgentDecisionResult> {
    const startTime = Date.now();
    const character = this.registry.get(request.characterId);

    if (!character) {
      throw new AgentError(`Character not found: ${request.characterId}`, request.characterId);
    }

    this.log.debug({
      characterId: character.id,
      name: character.name,
      tier: character.activityTier,
      trigger: request.triggerEvent?.type,
    }, 'Running decision');

    // --- beforeDecision middleware ---
    if (this.middleware) {
      const ctx: MiddlewareContext = {
        characterId: character.id,
        playerId: request.playerId,
        phase: 'beforeDecision',
        request,
        character,
        metadata: {},
      };
      await this.middleware.run('beforeDecision', ctx);
      if (ctx.abort) {
        const idleResult: AgentDecisionResult = {
          characterId: character.id,
          action: { type: 'idle' as const, thought: 'Aborted by middleware' },
          tokensUsed: 0,
          inferenceTier: 'light' as InferenceTier,
          durationMs: Date.now() - startTime,
        };
        return idleResult;
      }
    }

    try {
      // 1. Gather memory context
      const memoryContext = this.memory.getContext(
        character.id,
        request.playerId,
        {
          tags: request.triggerEvent ? [request.triggerEvent.type] : undefined,
          eventType: request.triggerEvent?.type,
        },
      );

      // 1b. Augment with semantic retrieval if SQL-first results are sparse
      if (this.semanticRetriever && memoryContext.episodicMemories.length < 2 && request.triggerEvent) {
        try {
          const semanticQuery = request.triggerEvent.data?.detail as string
            || request.triggerEvent.type;
          const semanticMems = await this.semanticRetriever.search(
            character.id, request.playerId, semanticQuery, 3,
          );
          for (const mem of semanticMems) {
            if (!memoryContext.episodicMemories.find(e => e.id === mem.id)) {
              memoryContext.episodicMemories.push(mem);
            }
          }
        } catch { /* Embedding service down — SQL retrieval still works */ }
      }

      // 2. Gather expansion hints
      const extensions: PromptExtensions = {};
      if (this.emotions) extensions.emotionHint = this.emotions.getEmotionPrompt(character.id);
      if (this.relationships) extensions.relationshipHint = this.relationships.getRelationshipPrompt(character.id);
      if (this.goals) extensions.goalHint = this.goals.getGoalPrompt(character.id);
      // Initiative hint: when this decision was triggered by character_initiative
      if (request.triggerEvent?.type === 'character_initiative') {
        const data = request.triggerEvent.data ?? {};
        const detail = data.detail as string | undefined;
        const reason = data.reason as string | undefined;
        extensions.initiativeHint = `You feel compelled to act on your own. ${detail || reason || 'Something drives you to act'}.`;
      }
      if (this.needs) extensions.needsHint = this.needs.getNeedsPrompt(character.id);
      if (this.routines) extensions.routineHint = this.routines.getRoutinePrompt(character.id);
      if (this.perception) extensions.perceptionHint = this.perception.getPerceptionPrompt(character.id);
      if (this.gossip) extensions.gossipHint = this.gossip.getGossipPrompt(character.id);
      if (this.reputation) extensions.reputationHint = this.reputation.getReputationPrompt(character.id);
      if (this.hierarchy) extensions.hierarchyHint = this.hierarchy.getHierarchyPrompt(character.id);
      if (this.worldState) extensions.worldStateHint = this.worldState.getWorldPrompt(request.proprioception.location);
      if (this.groups) extensions.groupHint = this.groups.getGroupPrompt(character.id);
      if (this.playerModeler) extensions.playerHint = this.playerModeler.getPlayerPrompt(request.playerId);

      // 3. Select inference tier
      const inferenceTier = this.tokenBudget.selectInferenceTier(
        character.activityTier,
        request.triggerEvent?.importance,
      );

      // 4. Limit tools to fit context budget
      // Each tool definition costs ~20-40 tokens in compact format; cap based on tier
      const maxTools = character.activityTier === 'active' ? 6
        : character.activityTier === 'background' ? 2 : 1;

      // Reorder tools: move recently-used tools to the end of the list
      // LLMs are biased toward tools appearing earlier, so this promotes variety
      const reorderedTools = this.reorderByRecency(character.id, request.availableTools);

      // Round-robin rotation: rotate which tools are exposed per decision
      let limitedTools: import('../core/types').ToolDefinition[];
      if (maxTools >= reorderedTools.length) {
        limitedTools = reorderedTools;
      } else {
        const rotation = this.toolRotation.get(character.id) ?? 0;
        this.toolRotation.set(character.id, rotation + 1);
        const start = rotation % reorderedTools.length;
        const indices: number[] = [];
        for (let i = 0; i < maxTools; i++) {
          indices.push((start + i) % reorderedTools.length);
        }
        limitedTools = indices.map(i => reorderedTools[i]);
      }

      // 4b. Assemble full LLM context (include recent actions + tool descriptions for variety)
      const recentActs = this.recentActions.get(character.id) ?? [];
      const messages = this.contextAssembler.assemble({
        character,
        gameState: request.gameState,
        proprioception: request.proprioception,
        episodicMemories: memoryContext.episodicMemories,
        workingMemory: memoryContext.workingMemory,
        characterSummary: memoryContext.characterSummary,
        triggerEvent: request.triggerEvent,
        recentActions: recentActs,
        extensions,
        availableTools: limitedTools.length > 0 ? limitedTools : undefined,
      });

      // 5. Call LLM (with context-size retry)
      const inferenceRequest: InferenceRequest = {
        messages,
        tools: limitedTools.length > 0 ? limitedTools : undefined,
        tier: inferenceTier,
        maxTokens: this.tokenBudget.getResponseBudget(character.activityTier),
        temperature: 0.7,
        characterId: character.id,
      };

      let response;
      try {
        response = await this.inference.complete(inferenceRequest);
      } catch (inferenceErr) {
        const errMsg = (inferenceErr as Error).message ?? '';
        // If context size exceeded, retry with minimal prompt (no tools, no extensions, light tier)
        if (errMsg.includes('Context size') || errMsg.includes('context length')) {
          this.log.warn({ characterId: character.id, tier: inferenceTier }, 'Context exceeded, retrying with minimal prompt');
          try {
            const minimalMessages: import('../core/types').InferenceMessage[] = [
              { role: 'system', content: `You are ${character.name}, a ${character.archetype}. Decide: use a tool, speak, or idle. Be brief.` },
              { role: 'user', content: `Location: ${request.proprioception.location}. What do you do?` },
            ];
            response = await this.inference.complete({
              messages: minimalMessages,
              tier: 'light',
              maxTokens: 60,
              temperature: 0.7,
              characterId: character.id,
            });
          } catch (retryErr) {
            // Even minimal prompt failed — return idle
            this.log.warn({ characterId: character.id }, 'Minimal retry also failed, returning idle');
            const idleResult: AgentDecisionResult = {
              characterId: character.id,
              action: { type: 'idle' as const, thought: 'Context budget exceeded' },
              tokensUsed: 0,
              inferenceTier: 'light' as InferenceTier,
              durationMs: Date.now() - startTime,
            };
            this.emitter.emit('agent:decision', idleResult);
            return idleResult;
          }
        } else {
          throw inferenceErr;
        }
      }

      // 5. Parse response into action (with retry-nudge for confused models)
      let action = this.parseAction(response.content, response.toolCalls);

      // 5b. Retry with nudge if model produced narration/questions instead of a tool call
      if (!('toolName' in action) && action.type === 'dialogue' && limitedTools.length > 0 && this.looksLikeNarration(action.content)) {
        this.log.debug({ characterId: character.id }, 'Model narrated instead of acting — retrying with nudge');
        try {
          const nudgeMessages = [
            ...messages,
            { role: 'assistant' as const, content: response.content },
            { role: 'user' as const, content: 'You must pick a tool and act NOW. Respond with JSON only: {"tool": "<name>", "arguments": {}}' },
          ];
          const nudgeResponse = await this.inference.complete({
            messages: nudgeMessages,
            tools: limitedTools,
            tier: inferenceTier,
            maxTokens: this.tokenBudget.getResponseBudget(character.activityTier),
            temperature: 0.7,
            characterId: character.id,
          });
          const nudgeAction = this.parseAction(nudgeResponse.content, nudgeResponse.toolCalls);
          if ('toolName' in nudgeAction) {
            action = nudgeAction;
            // Update response tokens (add both calls)
            response.tokensUsed.total += nudgeResponse.tokensUsed.total;
            response.tokensUsed.prompt += nudgeResponse.tokensUsed.prompt;
            response.tokensUsed.completion += nudgeResponse.tokensUsed.completion;
          }
          // If still not a tool call, keep original dialogue action
        } catch {
          // Nudge retry failed — keep original action
        }
      }

      // 6. Execute tool if action is a tool call
      let toolSucceeded = false;
      if ('toolName' in action) {
        // Build context-rich execution context
        const toolContext: ToolExecutionContext = {
          characterId: character.id,
          characterName: character.name,
          activityTier: character.activityTier,
          closeness: character.closeness,
          gameState: request.gameState,
          proprioception: request.proprioception,
        };

        // --- beforeToolExec middleware ---
        if (this.middleware) {
          const toolCtx: MiddlewareContext = {
            characterId: character.id,
            playerId: request.playerId,
            phase: 'beforeToolExec',
            toolCall: action,
            character,
            metadata: {},
          };
          await this.middleware.run('beforeToolExec', toolCtx);
          if (toolCtx.abort) {
            // Skip tool execution, treat as idle
            const idleResult: AgentDecisionResult = {
              characterId: character.id,
              action: { type: 'idle' as const, thought: 'Tool execution aborted by middleware' },
              tokensUsed: response.tokensUsed.total,
              inferenceTier,
              durationMs: Date.now() - startTime,
            };
            return idleResult;
          }
        }

        let toolResult: import('../core/types').ToolResult;
        try {
          toolResult = await this.toolExecutor.execute(
            action,
            character.id,
            character.activityTier,
            character.closeness,
            toolContext,
          );
        } catch (toolErr) {
          // LLM hallucinated a tool or validation failed — gracefully fall back to idle
          this.log.warn({
            characterId: character.id,
            tool: action.toolName,
            error: (toolErr as Error).message,
          }, 'Tool call failed, falling back to idle');

          const fallbackResult: AgentDecisionResult = {
            characterId: character.id,
            action: { type: 'idle' as const, thought: `Wanted to use ${action.toolName} but it wasn't available` },
            tokensUsed: response.tokensUsed.total,
            inferenceTier,
            durationMs: Date.now() - startTime,
          };
          this.emitter.emit('agent:decision', fallbackResult);
          return fallbackResult;
        }

        toolSucceeded = toolResult.success;

        // --- afterToolExec middleware ---
        if (this.middleware) {
          const toolCtx: MiddlewareContext = {
            characterId: character.id,
            playerId: request.playerId,
            phase: 'afterToolExec',
            toolCall: action,
            toolResult,
            character,
            metadata: {},
          };
          await this.middleware.run('afterToolExec', toolCtx);
        }

        // Record tool result as working memory (guard against DB-closed during shutdown)
        try {
          this.memory.addWorkingMemory(
            character.id,
            request.playerId,
            'assistant',
            `Used ${action.toolName}: ${toolResult.success ? 'success' : 'failed'}`,
          );
        } catch (memErr) {
          this.log.debug({ error: (memErr as Error).message }, 'Working memory write skipped');
        }

        // Process side effects
        if (toolResult.sideEffects) {
          for (const sideEffect of toolResult.sideEffects) {
            this.emitter.emit('game:event', sideEffect);
          }
        }
      }

      // 7. Process emotions from trigger event
      if (this.emotions && request.triggerEvent) {
        this.emotions.processEvent(character.id, request.triggerEvent);
      }

      // 7b. Feed decision outcome back into expansion systems
      // Only feed back tool results that actually succeeded
      this.processDecisionFeedback(character.id, action, toolSucceeded);

      // 8. Record to memory if warranted (guard against DB-closed during shutdown)
      if (request.triggerEvent) {
        const actionDesc = 'toolName' in action
          ? `Used tool: ${action.toolName}`
          : action.type === 'dialogue'
            ? `Said: "${(action as DialogueAction).content.slice(0, 100)}"`
            : 'Idle';

        try {
          this.memory.recordEvent(
            character.id,
            request.playerId,
            request.triggerEvent,
            `${request.triggerEvent.type}: ${JSON.stringify(request.triggerEvent.data ?? {}).slice(0, 200)}`,
            actionDesc,
            [request.triggerEvent.type],
          );
        } catch (memErr) {
          this.log.debug({ error: (memErr as Error).message }, 'Memory record skipped (DB may be closed)');
        }
      }

      // 9. Track action for recency (decision variety)
      const actionLabel = 'toolName' in action
        ? `tool:${(action as ToolCall).toolName}`
        : action.type === 'dialogue' ? 'dialogue' : 'idle';
      const recent = this.recentActions.get(character.id) ?? [];
      recent.push(actionLabel);
      if (recent.length > AgentRunner.MAX_RECENT) recent.shift();
      this.recentActions.set(character.id, recent);

      const result: AgentDecisionResult = {
        characterId: character.id,
        action,
        reasoning: response.content,
        tokensUsed: response.tokensUsed.total,
        inferenceTier,
        durationMs: Date.now() - startTime,
      };

      // --- afterDecision middleware ---
      if (this.middleware) {
        const ctx: MiddlewareContext = {
          characterId: character.id,
          playerId: request.playerId,
          phase: 'afterDecision',
          request,
          result,
          character,
          metadata: {},
        };
        await this.middleware.run('afterDecision', ctx);
      }

      // 10. Log decision to DB (skip if shutting down)
      if (this.decisionRepo && !this.stopped) {
        try {
          const entry: DecisionLogEntry = {
            id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            characterId: character.id,
            playerId: request.playerId,
            triggerType: request.triggerEvent?.type ?? 'tick',
            triggerEvent: request.triggerEvent ? JSON.stringify(request.triggerEvent) : undefined,
            contextTokens: response.tokensUsed.prompt,
            responseTokens: response.tokensUsed.completion,
            inferenceTier,
            action: JSON.stringify(action),
            durationMs: result.durationMs,
            createdAt: Date.now(),
          };
          this.decisionRepo.record(entry);
        } catch (logErr) {
          this.log.warn({ error: (logErr as Error).message }, 'Failed to log decision');
        }
      }

      this.emitter.emit('agent:decision', result);
      return result;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emitter.emit('agent:error', character.id, err);
      this.log.error({ characterId: character.id, error: err.message }, 'Decision failed');
      throw new AgentError(`Decision failed for ${character.name}: ${err.message}`, character.id);
    }
  }

  /**
   * Run decisions for multiple agents concurrently.
   * Leverages LM Studio batch concurrency.
   */
  async runBatch(requests: AgentDecisionRequest[]): Promise<AgentDecisionResult[]> {
    this.log.info({ count: requests.length }, 'Running batch decisions');

    const results = await Promise.allSettled(
      requests.map(req => this.runDecision(req)),
    );

    return results.map((result, i) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }

      this.log.error({
        characterId: requests[i].characterId,
        error: result.reason?.message,
      }, 'Batch decision failed');

      // Return an idle action for failed decisions
      return {
        characterId: requests[i].characterId,
        action: { type: 'idle' as const, thought: 'Decision failed' },
        tokensUsed: 0,
        inferenceTier: 'light' as InferenceTier,
        durationMs: 0,
      };
    });
  }

  // --- Persistence ---

  saveState(repo: StateRepository): void {
    const data: Array<{ characterId: string; actions: string }> = [];
    for (const [characterId, actions] of this.recentActions) {
      data.push({ characterId, actions: JSON.stringify(actions) });
    }
    repo.clearRecentActions();
    if (data.length > 0) repo.saveRecentActions(data);
  }

  loadState(repo: StateRepository): void {
    const rows = repo.loadAllRecentActions();
    this.recentActions.clear();
    for (const r of rows) {
      this.recentActions.set(r.characterId, JSON.parse(r.actions));
    }
    this.log.debug({ count: rows.length }, 'Recent actions loaded from DB');
  }

  /**
   * Feed decision outcomes back into expansion systems (emotions, relationships, goals).
   */
  private processDecisionFeedback(
    characterId: string,
    action: ToolCall | DialogueAction | IdleAction,
    toolSucceeded: boolean = false,
  ): void {
    try {
      if ('toolName' in action) {
        const toolName = action.toolName;
        const args = action.arguments ?? {};

        // Needs fulfillment from tool actions — only if tool succeeded
        if (this.needs && toolSucceeded) {
          this.needs.processToolResult(characterId, toolName);
        }

        // Gossip spreading during talk_to
        if (this.gossip && toolName === 'talk_to') {
          const target = (args.target as string) ?? null;
          if (target) {
            this.gossip.spreadBetween(characterId, target);
          }
        }

        // Reputation from witnessed actions
        if (this.reputation && toolSucceeded) {
          this.reputation.processToolExecution(characterId, toolName, toolSucceeded, this.gossip);
        }

        // Emotions from tool actions
        if (this.emotions) {
          switch (toolName) {
            case 'talk_to':
              this.emotions.applyEmotion(characterId, 'trust', 0.3, `action:${toolName}`);
              break;
            case 'fight':
              this.emotions.applyEmotion(characterId, 'anger', 0.5, `action:${toolName}`);
              this.emotions.applyEmotion(characterId, 'anticipation', 0.4, `action:${toolName}`);
              break;
            case 'trade':
              this.emotions.applyEmotion(characterId, 'anticipation', 0.3, `action:${toolName}`);
              break;
            case 'investigate':
              this.emotions.applyEmotion(characterId, 'anticipation', 0.4, `action:${toolName}`);
              this.emotions.applyEmotion(characterId, 'surprise', 0.2, `action:${toolName}`);
              break;
            case 'rest':
              this.emotions.applyEmotion(characterId, 'joy', 0.2, `action:${toolName}`);
              break;
          }
        }

        // Relationship updates from interactions
        if (this.relationships) {
          const target = (args.target as string) ?? null;
          if (target) {
            switch (toolName) {
              case 'talk_to': {
                // Talking to a superior in any shared faction gives a bigger relationship boost
                let talkBoost = 0.5;
                if (this.hierarchy) {
                  const charFactions = this.hierarchy.getCharacterFactions(characterId);
                  for (const cf of charFactions) {
                    const superiors = this.hierarchy.getSuperiors(characterId, cf.factionId);
                    if (superiors.some(s => s.characterId === target)) {
                      talkBoost = 0.8;
                      break;
                    }
                  }
                }
                this.relationships.recordInteraction(characterId, target, 'positive', talkBoost);
                break;
              }
              case 'trade':
                this.relationships.recordInteraction(characterId, target, 'positive', 0.8);
                break;
              case 'fight':
                this.relationships.recordInteraction(characterId, target, 'negative', 1.0);
                break;
            }
          }
        }

        // Goal step progression — keyword match tool name against active goal steps
        if (this.goals) {
          const activeGoals = this.goals.getActiveGoals(characterId);
          for (const goal of activeGoals) {
            if (goal.status !== 'active') continue;
            const stepIndex = goal.steps.findIndex(s => !s.completed);
            if (stepIndex === -1) continue;
            const stepDesc = goal.steps[stepIndex].description.toLowerCase();
            // Match if tool name or any argument value appears in the step description
            if (stepDesc.includes(toolName) ||
                Object.values(args).some(v => typeof v === 'string' && stepDesc.includes(v.toLowerCase()))) {
              this.goals.completeStep(goal.id, stepIndex);
              this.log.debug({ characterId, goalId: goal.id, stepIndex }, 'Goal step completed from action');
            }
          }
        }
      } else if (action.type === 'dialogue') {
        // Dialogue generates mild trust
        if (this.emotions) {
          this.emotions.applyEmotion(characterId, 'trust', 0.15, 'action:dialogue');
        }
      }
    } catch (err) {
      this.log.debug({ error: (err as Error).message }, 'Decision feedback processing failed');
    }
  }

  private parseAction(
    rawContent: string,
    toolCalls?: ToolCall[],
  ): ToolCall | DialogueAction | IdleAction {
    // 0. Strip CoT thinking tags and [assistant] prefix
    const content = rawContent
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/^\[assistant\]\s*/i, '')
      .trim();

    // 1. Check for native tool calls
    if (toolCalls && toolCalls.length > 0) {
      return toolCalls[0]; // Use the first tool call
    }

    // 2. Try to parse tool call from text (strict JSON)
    const parsedTool = this.toolExecutor.parseToolCallFromText(content);
    if (parsedTool) {
      return parsedTool;
    }

    // 3. Try fuzzy JSON recovery — fix common LLM JSON mistakes
    const fuzzyParsed = this.fuzzyParseToolCall(content);
    if (fuzzyParsed) {
      return fuzzyParsed;
    }

    // 4. If content has meaningful text, treat as dialogue
    const trimmed = content.trim();
    if (trimmed.length > 0 && trimmed.length < 1000) {
      return { type: 'dialogue', content: trimmed };
    }

    // 5. Default to idle
    return { type: 'idle', thought: trimmed || undefined };
  }

  /**
   * Reorder tools so recently-used ones appear last.
   * LLMs are biased toward earlier items in tool lists.
   * This ensures underused tools get prime position.
   */
  private reorderByRecency(
    characterId: string,
    tools: import('../core/types').ToolDefinition[],
  ): import('../core/types').ToolDefinition[] {
    const recent = this.recentActions.get(characterId) ?? [];
    if (recent.length === 0) return tools;

    // Count how many times each tool was used recently
    const usageCount = new Map<string, number>();
    for (const action of recent) {
      if (action.startsWith('tool:')) {
        const name = action.slice(5);
        usageCount.set(name, (usageCount.get(name) ?? 0) + 1);
      }
    }

    if (usageCount.size === 0) return tools;

    // Sort: unused tools first, then by ascending usage count
    return [...tools].sort((a, b) => {
      const aCount = usageCount.get(a.name) ?? 0;
      const bCount = usageCount.get(b.name) ?? 0;
      return aCount - bCount;
    });
  }

  /**
   * Detect narration, meta-questions, or GM-style text that should be a tool call.
   * Returns true if the text looks like the model is confused about its role.
   */
  private looksLikeNarration(text: string): boolean {
    const lower = text.toLowerCase();

    // Questions directed at a player/user (not in-character dialogue)
    if (/\b(what would you|what do you|would you like|how should i|shall i|what shall|what .* next)\b/.test(lower)) return true;

    // Narrator/GM patterns
    if (/\b(roll for|roll a d|make a check|the scene|you see a|you notice)\b/.test(lower)) return true;

    // Scene-setting narration: "You are currently...", "You have arrived...", "The market is..."
    if (/^(you are currently|you have arrived|you can see|you can move|you decide to|you need to)\b/.test(lower)) return true;

    // Third-person narration: "The warrior...", "The villagers...", "The market is bustling..."
    if (/^the \w+\s+(is|are|was|were|has|have)\b/.test(lower)) return true;

    // Third-person narration about self
    if (/^(he |she |they )(walks|looks|moves|decides|thinks|considers|turns|heads|goes|stands)\b/.test(lower)) return true;

    // Describing what tools can do instead of using them
    if (/\b(you can (?:move|trade|talk|rest|investigate|craft))\b/.test(lower)) return true;

    // "The recent events indicate..." — model explaining context back
    if (/^the recent\b/.test(lower)) return true;

    // Asterisk-wrapped action narration: *walks to the market*
    if (/^\*[^*]+\*\s*$/.test(text.trim())) return true;

    // Asking clarifying questions (multiple question marks or ends with ?)
    if ((text.match(/\?/g) || []).length >= 2) return true;

    // Very long text (>200 chars) that isn't dialogue is likely narration
    if (text.length > 200) return true;

    return false;
  }

  /**
   * Fuzzy JSON recovery for malformed LLM output.
   * Handles: trailing commas, single quotes, unquoted keys, missing braces.
   */
  private fuzzyParseToolCall(text: string): ToolCall | null {
    // Look for anything that resembles a tool call JSON
    const jsonLike = text.match(/\{[\s\S]*?(?:tool|name|action)[\s\S]*?\}/);
    if (!jsonLike) return null;

    let candidate = jsonLike[0];

    // Fix single quotes → double quotes
    candidate = candidate.replace(/'/g, '"');
    // Fix trailing commas before closing braces
    candidate = candidate.replace(/,\s*}/g, '}');
    candidate = candidate.replace(/,\s*]/g, ']');
    // Fix unquoted keys: { tool: "..." } → { "tool": "..." }
    candidate = candidate.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');

    try {
      const parsed = JSON.parse(candidate);
      const toolName = parsed.tool ?? parsed.name ?? parsed.action;
      if (typeof toolName === 'string' && toolName.length > 0) {
        return {
          toolName,
          arguments: parsed.arguments ?? parsed.params ?? parsed.args ?? {},
        };
      }
    } catch { /* Still not valid — give up */ }

    return null;
  }
}
