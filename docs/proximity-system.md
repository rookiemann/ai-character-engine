# AI Character Engine -- Proximity System

## Overview

The proximity system tracks how "close" each character is to the player, using a numeric closeness score from 0 to 100. Closeness determines a character's **activity tier**, which controls how often the character is processed, how many tokens it receives, and what capabilities are unlocked.

This system creates emergent behavior: characters the player interacts with frequently become more active, responsive, and capable, while neglected characters gradually fade into the background.

**Key Files:**
- `src/proximity/ProximityManager.ts` -- Core closeness tracking and tier management
- `src/proximity/ProximityRules.ts` -- Tier calculation rules
- `src/proximity/DelegationManager.ts` -- Delegation capability (closeness >= 60)
- `src/scheduler/ActivityTierManager.ts` -- Tier-aware scheduling integration

---

## Closeness Scale

Closeness is a continuous value from 0 to 100:

```
0          5         20         40         60        100
|----------|----------|----------|----------|----------|
  removed    dormant    background   chat     active/
  from sim              processing  enabled  delegate
```

- **0-4:** Character is effectively inactive (below dormant threshold)
- **5-19:** Dormant -- minimal processing, slowest tick rate
- **20-39:** Background -- moderate processing, slow tick rate
- **40-59:** Background with chat enabled -- player can chat with the character
- **60-100:** Active -- full processing, fast tick rate, delegation enabled

---

## Activity Tiers

Characters are automatically assigned to one of three tiers based on their closeness:

### Active Tier (closeness >= 60)

- **Processing frequency:** Every fast tick (default: 2 seconds)
- **Context tokens:** 800
- **Response tokens:** 150
- **Max tools:** 6 (all available tools)
- **Capabilities:** Full decision-making, chat, delegation, all tool access
- **LLM tier:** heavy (highest quality model)

### Background Tier (closeness >= 20)

- **Processing frequency:** Every slow tick (default: 30 seconds)
- **Context tokens:** 400
- **Response tokens:** 100
- **Max tools:** 2 (round-robin subset)
- **Capabilities:** Reduced decision-making, chat (if closeness >= 40)
- **LLM tier:** mid

### Dormant Tier (closeness >= 5)

- **Processing frequency:** Every slow tick (default: 30 seconds)
- **Context tokens:** 250
- **Response tokens:** 80
- **Max tools:** 1 (round-robin subset)
- **Capabilities:** Minimal decision-making only
- **LLM tier:** light (fastest/cheapest model)

### Comparison Table

| Property | Active | Background | Dormant |
|----------|--------|------------|---------|
| Closeness threshold | >= 60 | >= 20 | >= 5 |
| Tick frequency | fast (2s) | slow (30s) | slow (30s) |
| Context tokens | 800 | 400 | 250 |
| Response tokens | 150 | 100 | 80 |
| Max tools per decision | 6 | 2 | 1 |
| Tool selection | All available | Round-robin | Round-robin |
| Chat enabled | Yes | If closeness >= 40 | No |
| Delegation enabled | Yes | No | No |
| LLM inference tier | heavy | mid | light |

---

## Closeness Decay

Closeness naturally decays over time if the player does not interact with the character. This creates a "use it or lose it" dynamic.

### Decay Mechanics

Decay happens on every **slow tick** (default: every 30 seconds):

```
newCloseness = closeness - decayRatePerTick * multiplier
```

- **Base decay rate:** `decayRatePerTick` (default: 0.1 per slow tick)
- **High water multiplier:** If the character has ever reached a higher closeness (tracked via `highWaterMark`), the decay is reduced by `highWaterDecayMultiplier` (default: 0.5)

### High Water Mark

The `highWaterMark` tracks the highest closeness a character has ever reached with a given player. Characters that were once very close to the player decay more slowly, simulating an established relationship that is harder to forget.

```
Example:
  Character A: closeness = 50, highWaterMark = 80
    Decay = 0.1 * 0.5 = 0.05 per slow tick (established relationship)

  Character B: closeness = 50, highWaterMark = 50
    Decay = 0.1 * 1.0 = 0.1 per slow tick (new relationship)
```

### Tier Transitions

When closeness crosses a tier boundary, the engine:
1. Updates the character's `activityTier`
2. Emits a `proximity:tierChanged` event with `(characterId, oldTier, newTier)`
3. Calls the plugin's `onTierChanged()` hook (if defined)
4. Adjusts token budgets and processing frequency immediately

---

## Closeness Boosts

Characters gain closeness when the player interacts with them:

### Interaction Boost

When a character executes a tool in response to a game event involving the player:
- **Amount:** `interactionBoost` (default: 4)
- **Trigger:** After a successful tool execution from an agent decision

### Chat Boost

When the player sends a chat message to the character:
- **Amount:** `chatBoost` (default: 2)
- **Trigger:** Each player chat message via `engine.chatWith()`

### Manual Boost

Games can manually boost closeness via the Engine API:

```typescript
// Boost character's closeness by 10 points
engine.boostCloseness('character-1', 10, 'player-1');
```

### Boost Capping

Closeness is always clamped to the range [0, 100]. Boosts that would exceed 100 are capped. The `highWaterMark` is updated whenever closeness reaches a new peak.

---

## Capability Unlocks

Certain features are gated behind closeness thresholds:

### Chat (closeness >= 40)

The player can only chat with characters whose closeness is at or above `chatMinCloseness` (default: 40). Attempting to chat with a character below this threshold will be rejected.

```typescript
// This will succeed only if character's closeness >= 40
const response = await engine.chatWith('character-1', 'Hello there!');
```

### Delegation (closeness >= 60)

The player can only delegate instructions to characters at or above `delegateMinCloseness` (default: 60). This represents a level of trust where the character will follow the player's orders.

```typescript
// This will succeed only if character's closeness >= 60
engine.delegateTo('character-1', 'Guard the entrance', 'security');
```

### Tool-Level Gating

Individual tools can declare minimum tier or closeness requirements:

```typescript
const toolDef: ToolDefinition = {
  name: 'secret_passage',
  description: 'Reveal a secret passage',
  parameters: [],
  requiredTier: 'active',   // Only active-tier characters can use this
  minCloseness: 70,          // Only characters with closeness >= 70
};
```

---

## Tool Rotation

Background and dormant tiers receive a limited number of tools per decision. To ensure characters in these tiers still have access to all tools over time, the engine uses a **round-robin rotation** strategy.

### How It Works

1. All registered tools are maintained in an ordered list
2. Each tick, a different subset of tools is selected for background/dormant characters
3. The rotation index advances each tick
4. Over several ticks, every tool appears in the rotation

### Example

Given 6 tools `[move, talk_to, investigate, trade, craft, rest]`:

| Tick | Active (6 tools) | Background (2 tools) | Dormant (1 tool) |
|------|-------------------|----------------------|-------------------|
| 1 | All 6 | move, talk_to | move |
| 2 | All 6 | investigate, trade | talk_to |
| 3 | All 6 | craft, rest | investigate |
| 4 | All 6 | move, talk_to | trade |
| 5 | All 6 | investigate, trade | craft |
| 6 | All 6 | craft, rest | rest |

### Reordering by Recency

Within each tier, the `AgentRunner.reorderByRecency()` method sorts tools by ascending recent usage. Tools the character has not used recently appear first in the tool list. This exploits LLM positional bias (models tend to favor earlier items in a list) to encourage tool diversity.

---

## ProximityScore Data Structure

```typescript
interface ProximityScore {
  characterId: string;
  playerId: string;
  closeness: number;          // Current closeness (0-100)
  highWaterMark: number;      // Highest closeness ever reached
  activityTier: ActivityTier; // Current tier: 'active' | 'background' | 'dormant'
  lastInteractionAt: number;  // Timestamp of last interaction
  totalInteractions: number;  // Lifetime interaction count
  updatedAt: number;          // Last update timestamp
}
```

---

## Configuration Reference

All proximity settings are under the `proximity` key in the engine configuration. All fields are optional and fall back to defaults.

```json
{
  "proximity": {
    "decayRatePerTick": 0.1,
    "interactionBoost": 4,
    "chatBoost": 2,
    "promotionThreshold": 60,
    "backgroundThreshold": 20,
    "dormantThreshold": 5,
    "chatMinCloseness": 40,
    "delegateMinCloseness": 60,
    "highWaterDecayMultiplier": 0.5
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `decayRatePerTick` | number | 0.1 | Closeness decay per slow tick |
| `interactionBoost` | number | 4 | Closeness gain on tool interaction |
| `chatBoost` | number | 2 | Closeness gain per chat message |
| `promotionThreshold` | number | 60 | Minimum closeness for active tier |
| `backgroundThreshold` | number | 20 | Minimum closeness for background tier |
| `dormantThreshold` | number | 5 | Minimum closeness for dormant tier (below this, character is inactive) |
| `chatMinCloseness` | number | 40 | Minimum closeness required to chat |
| `delegateMinCloseness` | number | 60 | Minimum closeness required to delegate |
| `highWaterDecayMultiplier` | number | 0.5 | Decay multiplier for established relationships (lower = slower decay) |

---

## Events

The proximity system emits the following events:

### `proximity:changed`

Fired whenever a character's closeness score is updated (decay, boost, manual change).

```typescript
engine.events.on('proximity:changed', (score: ProximityScore) => {
  console.log(`${score.characterId}: closeness=${score.closeness}, tier=${score.activityTier}`);
});
```

### `proximity:tierChanged`

Fired when a character transitions between activity tiers.

```typescript
engine.events.on('proximity:tierChanged', (charId, oldTier, newTier) => {
  console.log(`${charId} moved from ${oldTier} to ${newTier}`);
  // Example: "guard-1 moved from background to active"
});
```

---

## Runtime Configuration

Proximity settings can be updated at runtime without restarting the engine:

```typescript
engine.updateConfig({
  proximity: {
    decayRatePerTick: 0.05,      // Slower decay
    interactionBoost: 6,          // Stronger interaction reward
    promotionThreshold: 50,       // Easier to reach active tier
  }
});
```

Changes take effect on the next tick cycle.

---

## Integration with Other Systems

The proximity system interacts with several other subsystems:

- **TickScheduler:** Uses tier to determine processing frequency and batch priority
- **TokenBudget:** Allocates context/response tokens based on tier
- **ToolRegistry:** Filters tools by tier requirements and rotation
- **ChatService:** Enforces `chatMinCloseness` gate
- **DelegationManager:** Enforces `delegateMinCloseness` gate
- **AgentRunner:** Receives tier-appropriate tool lists and token budgets
- **ContextAssembler:** Adjusts memory retrieval count and extension data based on tier budget
- **PlayerModeler:** Records interactions that trigger closeness boosts
- **PromptBuilder:** Includes closeness context in the character's system prompt

---

## Example: Closeness Lifecycle

```
Time 0:  Player enters area near "Merchant Zara"
         Zara starts at closeness 0, tier dormant (if >= 5)

Time 1:  Player interacts with Zara (trade event)
         closeness: 0 + 4 (interactionBoost) = 4
         tier: below dormant threshold, still inactive

Time 2:  Player interacts again
         closeness: 4 + 4 = 8
         tier: dormant (>= 5), Zara starts getting processed on slow ticks

Time 5:  Player chats with Zara (closeness now 12 after more interactions)
         closeness: 12 + 2 (chatBoost) = 14
         tier: still dormant

Time 10: After many interactions
         closeness: 22
         tier: PROMOTED to background (>= 20)
         event: proximity:tierChanged('zara', 'dormant', 'background')

Time 15: Continued interaction
         closeness: 42
         tier: still background, but CHAT UNLOCKED (>= 40)

Time 20: Heavy interaction
         closeness: 62
         tier: PROMOTED to active (>= 60), DELEGATION UNLOCKED
         Zara now processed every fast tick with full token budget

Time 30: Player stops interacting, closeness decays
         closeness: 62 - (0.1 * 0.5) per slow tick = gradual decline
         (slow decay because highWaterMark = 62)

Time 60: Closeness drops to 58
         tier: DEMOTED to background (< 60)
         Still chat-enabled (>= 40)
```
