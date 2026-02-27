# HTTP API Reference

The AI Character Engine includes a built-in HTTP API server for controlling the engine, managing characters, and inspecting state. The server uses native Node.js `http` module with no external framework dependencies.

**Source:** `src/api/HttpServer.ts`

---

## Table of Contents

- [Server Configuration](#server-configuration)
- [General Notes](#general-notes)
- [Characters](#characters)
- [Chat](#chat)
- [Events](#events)
- [Proximity](#proximity)
- [Decisions](#decisions)
- [Social Systems](#social-systems)
- [State Management](#state-management)
- [System](#system)
- [Experiments](#experiments)
- [Error Handling](#error-handling)

---

## Server Configuration

```typescript
import { HttpServer } from './src/api/HttpServer';

const server = new HttpServer(engine, {
  port: 3000,    // Default: 3000
  host: '0.0.0.0', // Default: '0.0.0.0' (all interfaces)
});

await server.start();
// Server is now listening at http://0.0.0.0:3000

await server.stop();
```

---

## General Notes

- **Base URL:** All endpoints are under `/api/`.
- **Content-Type:** All requests and responses use `application/json`.
- **CORS:** Enabled for all origins (`Access-Control-Allow-Origin: *`). Methods: GET, POST, PUT, DELETE, OPTIONS.
- **Security Headers:**
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-Request-Id: req_<counter>` (unique per request, useful for debugging)
- **Body Size Limit:** 1MB (1,048,576 bytes). Requests exceeding this limit receive a 400 error.
- **Authentication:** None. There is no authentication or authorization. This is noted for future implementation. Do not expose the API to untrusted networks without adding an authentication layer.
- **Request IDs:** Every response includes a `requestId` field in error responses and an `X-Request-Id` header in all responses.

---

## Characters

### GET /api/characters

List all registered characters with their proximity data.

**Response:**

```json
{
  "characters": [
    {
      "id": "barkeep",
      "name": "Greta",
      "archetype": "barkeep",
      "identity": { "personality": "...", "backstory": "...", "goals": [], "traits": [] },
      "activityTier": "active",
      "closeness": 65.0,
      "highWaterMark": 65.0,
      "metadata": {},
      "createdAt": 1709000000000,
      "updatedAt": 1709000000000,
      "proximity": {
        "characterId": "barkeep",
        "playerId": "default",
        "closeness": 65.0,
        "highWaterMark": 65.0,
        "activityTier": "active",
        "lastInteractionAt": 1709000000000,
        "totalInteractions": 12,
        "updatedAt": 1709000000000
      }
    }
  ]
}
```

**Example:**

```bash
curl http://localhost:3000/api/characters
```

---

### GET /api/characters/:id

Get detailed information about a single character, including emotions and mood.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Character ID |

**Response (200):**

```json
{
  "character": {
    "id": "barkeep",
    "name": "Greta",
    "archetype": "barkeep",
    "identity": { "personality": "...", "backstory": "...", "goals": [], "traits": [] },
    "activityTier": "active",
    "closeness": 65.0,
    "highWaterMark": 65.0,
    "metadata": {},
    "createdAt": 1709000000000,
    "updatedAt": 1709000000000
  },
  "proximity": {
    "characterId": "barkeep",
    "playerId": "default",
    "closeness": 65.0,
    "highWaterMark": 65.0,
    "activityTier": "active",
    "lastInteractionAt": 1709000000000,
    "totalInteractions": 12,
    "updatedAt": 1709000000000
  },
  "emotions": {
    "characterId": "barkeep",
    "active": [
      { "type": "joy", "intensity": 0.6, "decayRate": 0.05, "source": "good_business", "createdAt": 1709000000000 }
    ],
    "mood": "joy",
    "moodIntensity": 0.6
  },
  "mood": "joy"
}
```

**Response (404):**

```json
{ "error": "Character not found: unknown_id" }
```

**Example:**

```bash
curl http://localhost:3000/api/characters/barkeep
```

---

### POST /api/characters

Register a new character in the engine.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique character identifier |
| `name` | string | Yes | Character name |
| `archetype` | string | Yes | Must match a registered archetype ID |
| `identity` | object | Yes | Personality, backstory, goals, traits |
| `initialCloseness` | number | No | Starting closeness (0-100) |
| `metadata` | object | No | Arbitrary metadata |

**Request Body Example:**

```json
{
  "id": "new_char",
  "name": "Sera",
  "archetype": "merchant",
  "identity": {
    "personality": "Quiet but perceptive.",
    "backstory": "A traveling alchemist.",
    "goals": ["Find rare ingredients"],
    "traits": ["observant", "cautious"]
  },
  "initialCloseness": 30
}
```

**Response (201):**

```json
{
  "character": {
    "id": "new_char",
    "name": "Sera",
    "archetype": "merchant",
    "activityTier": "background",
    "closeness": 30,
    "highWaterMark": 30,
    "metadata": {},
    "createdAt": 1709000000000,
    "updatedAt": 1709000000000
  }
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/characters \
  -H "Content-Type: application/json" \
  -d '{"id":"new_char","name":"Sera","archetype":"merchant","identity":{"personality":"Quiet but perceptive.","backstory":"A traveling alchemist.","goals":["Find rare ingredients"],"traits":["observant","cautious"]}}'
```

---

### DELETE /api/characters/:id

Remove a character from the engine.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Character ID to remove |

**Response (200):**

```json
{ "removed": "barkeep" }
```

**Response (404):**

```json
{ "error": "Character not found: unknown_id" }
```

**Example:**

```bash
curl -X DELETE http://localhost:3000/api/characters/barkeep
```

---

### GET /api/characters/:id/introspection

Get a comprehensive view of a character's internal state: memories, emotions, relationships, goals, needs, hierarchy, gossip, reputation, and more.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Character ID |

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `playerId` | string | Optional player ID (defaults to "default") |

**Response (200):**

```json
{
  "character": { "...CharacterState..." },
  "proximity": { "...ProximityScore..." },
  "emotions": { "...CharacterEmotions..." },
  "relationships": [ { "fromId": "barkeep", "toId": "guard", "type": "friend", "strength": 70, "trust": 80 } ],
  "goals": [ { "id": "g1", "description": "Keep the tavern profitable", "priority": 8, "status": "active", "steps": [] } ],
  "recentMemories": [ { "id": "m1", "content": "...", "importance": 7, "currentImportance": 6.5 } ],
  "summary": { "summary": "...", "relationshipNotes": "...", "keyFacts": [] },
  "groups": [],
  "workingMemory": [],
  "routine": null,
  "needs": { "characterId": "barkeep", "needs": [ { "type": "rest", "intensity": 0.3 } ] },
  "nearbyCharacters": ["merchant", "bard"],
  "gossipKnown": [],
  "reputation": { "characterId": "barkeep", "scores": { "general": 15 } },
  "hierarchy": [ { "characterId": "barkeep", "factionId": "tavern_staff", "rankLevel": 0 } ]
}
```

**Response (404):**

```json
{ "error": "Character not found: unknown_id" }
```

**Example:**

```bash
curl "http://localhost:3000/api/characters/barkeep/introspection?playerId=player1"
```

---

## Chat

### POST /api/chat/:characterId

Send a message to a character and receive a reply. Requires closeness >= 40 (configurable via `chatMinCloseness`).

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `characterId` | string | Character to chat with |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | Yes | The message to send |
| `playerId` | string | No | Player ID (defaults to "default") |

**Response (200):**

```json
{ "reply": "Welcome to the Rusty Flagon, dear! What can I get you?" }
```

**Notes:**
- The character must have closeness >= 40 to the player. Otherwise an error is returned.
- Chat interactions boost the character's closeness to the player.
- The conversation history is maintained in working memory.

**Example:**

```bash
curl -X POST http://localhost:3000/api/chat/barkeep \
  -H "Content-Type: application/json" \
  -d '{"message":"What is the mood in the tavern tonight?"}'
```

---

## Events

### POST /api/events

Inject a game event into the engine. The event will be distributed to characters based on importance, proximity, and event filtering.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event` | object | Yes | The event object |
| `event.type` | string | Yes | Event type (e.g., "bar_fight", "customer_arrives") |
| `event.source` | string | No | Who/what caused the event |
| `event.target` | string | No | Target of the event |
| `event.data` | object | No | Arbitrary event data |
| `event.importance` | number | No | Importance 1-10 |
| `event.timestamp` | number | Yes | Event timestamp (epoch ms) |
| `playerId` | string | No | Player ID |

**Response (200):**

```json
{ "injected": true }
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/events \
  -H "Content-Type: application/json" \
  -d '{"event":{"type":"bar_fight","source":"patron","data":{"severity":"minor"},"importance":7,"timestamp":1709000000000}}'
```

---

## Proximity

### GET /api/proximity/:characterId

Get the closeness score between a character and the player.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `characterId` | string | Character ID |

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `playerId` | string | Optional player ID (defaults to "default") |

**Response (200):**

```json
{
  "characterId": "barkeep",
  "playerId": "default",
  "closeness": 65.0,
  "highWaterMark": 65.0,
  "activityTier": "active",
  "lastInteractionAt": 1709000000000,
  "totalInteractions": 12,
  "updatedAt": 1709000000000
}
```

**Response (404):**

```json
{ "error": "No proximity data for: unknown_id" }
```

**Example:**

```bash
curl "http://localhost:3000/api/proximity/barkeep?playerId=player1"
```

---

### POST /api/proximity/:characterId/boost

Manually boost a character's closeness to the player.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `characterId` | string | Character ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `amount` | number | Yes | Amount to boost (can be negative) |
| `playerId` | string | No | Player ID |

**Response (200):**

```json
{
  "characterId": "barkeep",
  "playerId": "default",
  "closeness": 75.0,
  "highWaterMark": 75.0,
  "activityTier": "active",
  "lastInteractionAt": 1709000000000,
  "totalInteractions": 13,
  "updatedAt": 1709000000000
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/proximity/barkeep/boost \
  -H "Content-Type: application/json" \
  -d '{"amount":10}'
```

---

## Decisions

### POST /api/decisions/query

Query the decision log with optional filters.

**Request Body:**

The body is a filters object. The specific filter fields depend on the `DecisionLogEntry` schema. Common filters include character ID, time range, and action type.

```json
{
  "characterId": "barkeep",
  "limit": 10
}
```

**Response (200):**

```json
{
  "decisions": [
    {
      "id": "d_1",
      "characterId": "barkeep",
      "playerId": "default",
      "triggerType": "fast_tick",
      "triggerEvent": null,
      "contextTokens": 450,
      "responseTokens": 85,
      "inferenceTier": "heavy",
      "action": "serve_drink",
      "durationMs": 2800,
      "createdAt": 1709000000000
    }
  ],
  "count": 1
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/decisions/query \
  -H "Content-Type: application/json" \
  -d '{"characterId":"barkeep"}'
```

---

### GET /api/decisions/count

Get the total number of logged decisions.

**Response (200):**

```json
{ "count": 586 }
```

**Example:**

```bash
curl http://localhost:3000/api/decisions/count
```

---

## Social Systems

### POST /api/emotions/:characterId

Apply an emotion to a character.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `characterId` | string | Character ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `emotion` | string | Yes | Emotion type: joy, sadness, anger, fear, surprise, disgust, trust, anticipation |
| `intensity` | number | Yes | Intensity 0-1 |

**Response (200):**

```json
{
  "emotions": {
    "characterId": "barkeep",
    "active": [
      { "type": "joy", "intensity": 0.8, "decayRate": 0.05, "createdAt": 1709000000000 }
    ],
    "mood": "joy",
    "moodIntensity": 0.8
  }
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/emotions/barkeep \
  -H "Content-Type: application/json" \
  -d '{"emotion":"joy","intensity":0.8}'
```

---

### POST /api/relationships

Set or update a relationship between two characters.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `fromId` | string | Yes | Source character ID |
| `toId` | string | Yes | Target character ID |
| `type` | string | No | Relationship type: friend, rival, mentor, student, ally, enemy, neutral, romantic, family |
| `strength` | number | No | Relationship strength 0-100 |
| `trust` | number | No | Trust level 0-100 |

**Response (200):**

```json
{
  "relationship": {
    "fromId": "barkeep",
    "toId": "guard",
    "type": "friend",
    "strength": 70,
    "trust": 80,
    "notes": "",
    "lastInteractionAt": 1709000000000,
    "updatedAt": 1709000000000
  }
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/relationships \
  -H "Content-Type: application/json" \
  -d '{"fromId":"barkeep","toId":"guard","type":"friend","strength":70,"trust":80}'
```

---

### POST /api/goals/:characterId

Add a goal to a character.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `characterId` | string | Character ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | Yes | Goal description |
| `priority` | number | No | Priority 1-10 (default: 5) |
| `steps` | array | No | Array of goal steps |

**Response (201):**

```json
{
  "goal": {
    "id": "g_abc123",
    "characterId": "barkeep",
    "description": "Organize a tavern festival",
    "priority": 7,
    "status": "pending",
    "steps": [
      { "description": "Buy decorations", "completed": false },
      { "description": "Invite performers", "completed": false }
    ],
    "createdAt": 1709000000000
  }
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/goals/barkeep \
  -H "Content-Type: application/json" \
  -d '{"description":"Organize a tavern festival","priority":7,"steps":[{"description":"Buy decorations","completed":false}]}'
```

---

### POST /api/world-facts

Set a world fact in the persistent world state.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | string | Yes | Fact key (unique identifier) |
| `value` | any | Yes | Fact value (any JSON-serializable value) |
| `category` | string | Yes | Category for grouping |
| `source` | string | Yes | Who/what set this fact |

**Response (200):**

```json
{ "set": true, "key": "tavern_reputation" }
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/world-facts \
  -H "Content-Type: application/json" \
  -d '{"key":"tavern_reputation","value":"well-known","category":"locations","source":"narrator"}'
```

---

### GET /api/world-facts/:key

Get a world fact by key.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `key` | string | Fact key |

**Response (200):**

```json
{ "key": "tavern_reputation", "value": "well-known" }
```

**Response (404):**

```json
{ "error": "World fact not found: unknown_key" }
```

**Example:**

```bash
curl http://localhost:3000/api/world-facts/tavern_reputation
```

---

### POST /api/groups

Create a character group.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Group name |
| `memberIds` | string[] | Yes | Array of character IDs |
| `purpose` | string | Yes | Group purpose description |

**Response (201):**

```json
{
  "group": {
    "id": "grp_abc123",
    "name": "Tavern Staff",
    "memberIds": ["barkeep", "bard"],
    "leaderId": null,
    "purpose": "Keep the tavern running",
    "cohesion": 0.5,
    "createdAt": 1709000000000
  }
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/groups \
  -H "Content-Type: application/json" \
  -d '{"name":"Tavern Staff","memberIds":["barkeep","bard"],"purpose":"Keep the tavern running"}'
```

---

### POST /api/conversations

Start a multi-agent conversation between characters.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `participantIds` | string[] | Yes | Array of character IDs |
| `topic` | string | Yes | Conversation topic |
| `maxTurns` | number | No | Maximum conversation turns |

**Response (201):**

```json
{
  "conversation": {
    "id": "conv_abc123",
    "participantIds": ["barkeep", "guard"],
    "topic": "The suspicious stranger",
    "turns": [
      {
        "characterId": "barkeep",
        "content": "Did you see that cloaked figure?",
        "timestamp": 1709000000000
      },
      {
        "characterId": "guard",
        "content": "I have been watching them closely.",
        "timestamp": 1709000001000
      }
    ],
    "maxTurns": 6,
    "status": "completed",
    "startedAt": 1709000000000,
    "completedAt": 1709000006000
  }
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/conversations \
  -H "Content-Type: application/json" \
  -d '{"participantIds":["barkeep","guard"],"topic":"The suspicious stranger","maxTurns":6}'
```

---

## State Management

### POST /api/state/save

Persist the current engine state to the database.

**Request Body:** None required.

**Response (200):**

```json
{ "saved": true }
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/state/save
```

---

### POST /api/state/snapshot

Create a named snapshot of the current state.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Snapshot name (auto-generated if omitted) |

**Response (201):**

```json
{ "snapshotId": "snap_abc123" }
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/state/snapshot \
  -H "Content-Type: application/json" \
  -d '{"name":"before-boss-fight"}'
```

---

### GET /api/state/snapshots

List all saved snapshots.

**Response (200):**

```json
{
  "snapshots": [
    {
      "id": "snap_abc123",
      "name": "before-boss-fight",
      "description": "",
      "createdAt": 1709000000000
    }
  ]
}
```

**Example:**

```bash
curl http://localhost:3000/api/state/snapshots
```

---

### POST /api/state/export

Export the full engine state as a JSON object. Useful for backup or migration.

**Request Body:** None required.

**Response (200):**

Returns the complete engine state as a JSON object. The structure contains all character data, memories, relationships, world facts, and other subsystem state.

**Example:**

```bash
curl -X POST http://localhost:3000/api/state/export > backup.json
```

---

### POST /api/state/import

Import engine state from a JSON body. Overwrites current state.

**Request Body:** The full state JSON object (as exported by `/api/state/export`).

**Response (200):**

```json
{ "imported": true }
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/state/import \
  -H "Content-Type: application/json" \
  -d @backup.json
```

---

## System

### GET /api/stats

Get engine statistics including character counts by tier, inference usage, and scheduler state.

**Response (200):**

```json
{
  "characters": {
    "total": 4,
    "active": 1,
    "background": 2,
    "dormant": 1
  },
  "inference": {
    "totalRequests": 586,
    "totalTokens": 125000,
    "averageLatencyMs": 2800
  },
  "scheduler": {
    "fastTicks": 1200,
    "slowTicks": 40,
    "running": true
  }
}
```

**Example:**

```bash
curl http://localhost:3000/api/stats
```

---

### GET /api/health

Health check endpoint. Returns 200 if all systems are operational, 503 if any system is degraded.

**Response (200 or 503):**

```json
{
  "inference": true,
  "database": true
}
```

A status of `503` is returned if either `inference` or `database` is `false`.

**Example:**

```bash
curl http://localhost:3000/api/health
```

---

### GET /api/metrics

Get a detailed metrics snapshot including latency percentiles, tool usage distribution, hint rates, and more.

**Response (200):**

```json
{
  "latency": {
    "p50": 2800,
    "p90": 4200,
    "p99": 6100,
    "count": 586,
    "windowMs": 300000
  },
  "tools": {
    "serve_drink": 85,
    "tell_story": 62,
    "trade_item": 45,
    "patrol": 78,
    "observe": 52,
    "talk_to": 90
  },
  "actions": {
    "tool_call": 412,
    "dialogue": 150,
    "idle": 24
  },
  "hints": {
    "variety": 38,
    "unused_tool": 22
  }
}
```

**Notes:** Metrics use a sliding window (default 5 minutes). Values outside the window are dropped automatically.

**Example:**

```bash
curl http://localhost:3000/api/metrics
```

---

### POST /api/config

Update runtime configuration. Supports tick and proximity configuration changes without restart.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tick` | object | No | Tick configuration overrides |
| `tick.fastTickMs` | number | No | Fast tick interval in milliseconds |
| `tick.slowTickMs` | number | No | Slow tick interval in milliseconds |
| `tick.batchSize` | number | No | Concurrent LLM calls per batch |
| `proximity` | object | No | Proximity configuration overrides |
| `proximity.decayRatePerTick` | number | No | Closeness decay per tick |
| `proximity.interactionBoost` | number | No | Closeness boost per interaction |

**Response (200):**

```json
{ "updated": true }
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/config \
  -H "Content-Type: application/json" \
  -d '{"tick":{"fastTickMs":3000,"batchSize":8}}'
```

---

## Experiments

The engine includes an A/B testing system (`PromptExperiment`) for testing different prompt configurations. These endpoints manage experiment variants and lifecycle.

### GET /api/experiment

Get the current experiment report including variant performance data.

**Response (200):**

```json
{
  "active": false,
  "variants": [
    {
      "name": "control",
      "config": {},
      "weight": 1,
      "assignments": 50,
      "outcomes": { "tool_call": 30, "dialogue": 18, "idle": 2 }
    },
    {
      "name": "verbose_prompt",
      "config": { "systemPromptSuffix": "Be very detailed in your reasoning." },
      "weight": 1,
      "assignments": 48,
      "outcomes": { "tool_call": 35, "dialogue": 12, "idle": 1 }
    }
  ]
}
```

**Example:**

```bash
curl http://localhost:3000/api/experiment
```

---

### POST /api/experiment/variant

Register a new experiment variant.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Variant name |
| `config` | object | Yes | Variant configuration (prompt overrides, etc.) |
| `weight` | number | No | Selection weight (default: 1) |

**Response (201):**

```json
{ "registered": "verbose_prompt" }
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/experiment/variant \
  -H "Content-Type: application/json" \
  -d '{"name":"verbose_prompt","config":{"systemPromptSuffix":"Be very detailed."},"weight":1}'
```

---

### POST /api/experiment/start

Start the experiment. Variants will be assigned to characters using weighted random selection.

**Request Body:** None required.

**Response (200):**

```json
{ "started": true, "active": true }
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/experiment/start
```

---

### POST /api/experiment/stop

Stop the experiment and get the final report.

**Request Body:** None required.

**Response (200):**

```json
{
  "stopped": true,
  "report": {
    "active": false,
    "variants": [
      {
        "name": "control",
        "config": {},
        "weight": 1,
        "assignments": 50,
        "outcomes": { "tool_call": 30, "dialogue": 18, "idle": 2 }
      }
    ]
  }
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/experiment/stop
```

---

## Error Handling

All errors are returned as JSON with appropriate HTTP status codes.

### Error Response Format

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "requestId": "req_42"
}
```

The `code` field is present for `EngineError` subclasses. The `requestId` field is always present in error responses.

### HTTP Status Codes

| Status | Meaning | When |
|--------|---------|------|
| 200 | OK | Successful GET or POST |
| 201 | Created | Resource created (characters, goals, groups, snapshots, variants) |
| 204 | No Content | OPTIONS preflight response |
| 400 | Bad Request | Invalid JSON, missing required fields, type validation failure, body too large |
| 404 | Not Found | Resource not found (character, world fact, route) |
| 408 | Request Timeout | Inference provider timeout |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Unexpected errors (details not leaked to client) |
| 503 | Service Unavailable | Health check failed (inference or database down) |

### Error Types

The engine uses typed errors that map to specific HTTP status codes:

| Error Class | HTTP Status | Retriable | Description |
|-------------|-------------|-----------|-------------|
| `ValidationError` | 400 | No | Invalid input data |
| `TimeoutError` | 408 | Yes | Request timed out |
| `RateLimitError` | 429 | Yes | Rate limit exceeded |
| `InferenceError` | 500 | Yes | LLM provider error |
| `EngineError` | 500 | No | General engine error |

### Body Size Limit

Request bodies larger than 1MB (1,048,576 bytes) are rejected immediately with a 400 status:

```json
{ "error": "Request body exceeds 1048576 bytes" }
```

### Internal Errors

For non-EngineError exceptions, the server returns a 500 status with the error message but does not leak stack traces or internal implementation details to the client.
