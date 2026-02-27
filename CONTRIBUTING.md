# Contributing to AI Character Engine

Thank you for your interest in contributing to the AI Character Engine. This guide covers everything you need to get started, understand the codebase, and submit quality contributions.

---

## Getting Started

1. **Clone the repository:**

   ```bash
   git clone <repo-url>
   cd AI_player_engine
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Build the project:**

   ```bash
   npm run build
   ```

   TypeScript compiles to `dist/`.

4. **Run the test suite:**

   ```bash
   npm test
   ```

   This runs 415 unit tests via vitest.

5. **Configure a provider:**

   Copy the example config and fill in your provider details:

   ```bash
   cp engine.config.example.json engine.config.json
   ```

   Edit `engine.config.json` to point at your preferred LLM provider (vLLM, LM Studio, OpenRouter, OpenAI, Anthropic, or Ollama).

---

## Project Structure

```
src/
  core/         - Engine, config, types, errors
  agents/       - AgentRunner, ContextAssembler, PromptBuilder
  memory/       - MemoryManager, MemoryConsolidator, SemanticRetriever
  inference/    - InferenceService, providers/ (6 providers)
  tick/         - TickScheduler, InitiativeChecker
  proximity/    - ProximityManager
  tools/        - ToolRegistry, ToolValidator
  social/       - ChatService, DelegationManager, ConversationManager
  plugin/       - GamePlugin interface
  api/          - HttpServer (REST API)
  expansion/    - All expansion subsystems (emotions, goals, gossip, etc.)
tests/
  unit/         - Unit tests (vitest)
  e2e/          - End-to-end tests (requires live vLLM)
examples/
  sample-game/  - Tavern Tales demo
  game-simulations/ - Multi-genre stress tests
  api-server/   - HTTP API demo
docs/           - Documentation
```

---

## Code Style

- **TypeScript with CommonJS** -- this project uses CommonJS modules, not ESM. All files should use `require()` / `module.exports` patterns (or the TypeScript equivalents that compile to CommonJS).
- **Pino for logging** -- never use `console.log` in library code. Import and use the Pino logger instance.
- **Zod for validation** -- use Zod schemas to validate data at system boundaries (config parsing, API input, plugin data).
- **eventemitter3 for events** -- all event-driven communication uses eventemitter3.
- **No external HTTP frameworks** -- the HTTP API server uses native Node.js `http` module. Do not introduce Express, Fastify, or similar frameworks.

---

## Testing

- **Unit tests:**

  ```bash
  npm test
  ```

  Or in watch mode:

  ```bash
  npm run test:watch
  ```

- **End-to-end tests:**

  ```bash
  npm run test:e2e
  ```

  E2E tests require a live vLLM instance running. They exercise 32 characters making real LLM decisions.

- **All tests use vitest.** Follow existing test patterns when writing new tests.

- **Mock inference in unit tests.** Unit tests should never call a live LLM provider. Use mocked inference responses to keep tests fast and deterministic.

---

## How to Add a New Subsystem

1. **Create the class** in `src/expansion/` (or the appropriate directory if it fits better elsewhere).
2. **Wire it into the Engine constructor** in `src/core/Engine.ts`. The Engine is the top-level orchestrator that initializes and connects all subsystems.
3. **Add a config section** if needed in `src/core/config.ts`. Use Zod to define and validate the new config shape.
4. **Export from `src/index.ts`** so consumers can import the new subsystem.
5. **Add unit tests** in `tests/unit/`. Cover the core behavior and edge cases.
6. **Update documentation** to reflect the new subsystem's purpose and configuration.

---

## How to Add a New Inference Provider

1. **Create a class** extending `BaseProvider` in `src/inference/providers/`.
2. **Implement `complete()`** -- this is the required method for synchronous inference.
3. **Optionally implement `streamComplete()`** -- for providers that support streaming responses.
4. **Register in InferenceService's provider factory** so the provider can be instantiated by name from config.
5. **Add the provider type to the config schema** in `src/core/config.ts`.
6. **Add unit tests** covering successful completion, error handling, and any provider-specific behavior.

---

## PR Guidelines

- **Keep PRs focused.** One feature or one fix per PR. Avoid bundling unrelated changes.
- **Include tests** for any new functionality. Both happy-path and error cases.
- **Ensure the build passes:**

  ```bash
  npm run build
  npm test
  ```

  Both commands must complete without errors before submitting.
- **Describe what changed and why** in the PR description. Explain the motivation, not just what files were touched.
