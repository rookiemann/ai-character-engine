# Changelog

## [0.1.0] - 2026-02-27

### Initial Public Release

The AI Character Engine launches with 35 subsystems, 6 LLM providers, and a full HTTP API.

**Core Engine:**
- Engine orchestrator with plugin-based architecture
- AgentRunner with stateless LLM decision making
- ContextAssembler and PromptBuilder for intelligent context management
- ToolRegistry with validation, type coercion, and hallucination recovery
- TickScheduler with fast tick (active agents) and slow tick (background + maintenance)

**Memory System:**
- 3-tier memory: working (ring buffer) -> episodic (importance-scored, fading) -> summary (LLM-compressed)
- SemanticRetriever with optional embedding-based retrieval
- MemoryConsolidator with tag-based and semantic clustering
- EmbeddingService integration

**Social Systems:**
- ChatService for direct character conversations (closeness 40+)
- DelegationManager for player delegation (closeness 60+)
- ConversationManager for multi-agent conversations
- GossipManager for information propagation with credibility decay
- ReputationManager for collective witness-based scoring
- MoodContagionManager for ephemeral emotion spreading
- HierarchyManager for factions, ranks, and chain-of-command

**Agent Intelligence:**
- EmotionManager with mood tracking
- GoalPlanner with step-based goal tracking
- PlayerModeler for player preference learning
- NeedsManager with 5 default needs (rest, social, sustenance, safety, purpose)
- RoutineManager for phase-based daily activities
- InitiativeChecker for event-driven decisions
- PerceptionManager for spatial awareness and event filtering

**Infrastructure:**
- 6 LLM providers: Ollama, vLLM, LM Studio, OpenRouter, OpenAI, Anthropic
- FailoverChain with circuit breaker and exponential cooldown
- HTTP API server with 30 REST endpoints
- MetricsCollector with sliding-window latency percentiles
- PromptExperiment for A/B testing
- State persistence with snapshots and import/export
- Streaming chat support
- Multi-player support
- Error recovery (tool hallucination, context-size retry, graceful shutdown)
- Middleware pipeline
- Runtime configuration updates

**Lifecycle:**
- LifecycleManager for character death, cleanup, and auto-respawn

**Testing:**
- 415 unit tests
- 6 E2E tests (32 characters against live vLLM)
- TypeScript compiles cleanly (0 errors)

**Performance:**
- Benchmarked against 10 models
- Best: xLAM-2-1B at 11.91 decisions/sec with 32 characters
- Tool balance: no tool above 23%, all 6 tools represented
