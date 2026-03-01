# Troubleshooting Guide

Common issues when running the AI Character Engine, with causes and fixes.

---

## 1. Characters Only Talk, Never Use Tools

**Symptom:** Every decision produces `type: "dialogue"` or `type: "idle"`. Tool usage rate is 0% or near-zero.

**Causes:**

- **Wrong model.** Most general-purpose LLMs (Llama, Mistral, GPT-2) struggle with structured tool calling at small sizes. The engine needs a model explicitly trained for function calling.
- **Empty tool list.** If `GamePlugin.getTools()` returns an empty array, there's nothing to call.
- **Tool descriptions too vague.** The LLM can't figure out when to use a tool if the description is generic (e.g., "do something").

**Engine mechanism:**
- `PromptBuilder` (`src/agent/PromptBuilder.ts:153-163`) injects a strict instruction: *"You MUST pick a tool and act. Respond with ONLY valid JSON."*
- When tools are available but the model outputs narration, the nudge retry at `AgentRunner` (`src/agent/AgentRunner.ts:355-383`) appends a second prompt forcing JSON output.

**Fix:**

1. Use **xLAM-2-1B** (`Salesforce/xLAM-2-1b-fc-r`). It's explicitly trained for tool calling and produces valid JSON tool calls consistently.
2. Verify your plugin returns tools: add a `console.log(plugin.getTools().length)` check.
3. Run the diagnostic script to see raw model output:
   ```bash
   npx tsx examples/game-simulations/diagnose.ts
   ```
4. If using a different model, check that it supports the `{"tool": "<name>", "arguments": {...}}` JSON format.

---

## 2. Characters Repeat the Same Tool

**Symptom:** One tool dominates >40% of all decisions (e.g., `talk_to` at 60%). Other tools are barely used.

**Causes:**

- **Positional bias.** LLMs (especially small ones) are biased toward tools listed first in the prompt.
- **One tool description is much stronger** than others, making it the "obvious" choice.
- **Feedback loop.** Once a tool appears in recent memory, the model sees it as the precedent.

**Engine mechanisms:**

- **reorderByRecency** (`src/agent/AgentRunner.ts:788-812`): Sorts tools by ascending recent usage count. Tools the character hasn't used recently appear first in the prompt, counteracting positional bias.
- **Variety hints** (`src/agent/ContextAssembler.ts:121-148`): After building the situation context, checks recent actions. If any tool exceeds 40% of recent actions (`src/agent/ContextAssembler.ts:129-134`), it injects a warning: *"You have been doing {action} repeatedly. Choose a DIFFERENT action this time."*
- **Unused tool suggestions** (`src/agent/ContextAssembler.ts:136-147`): Appends *"You haven't tried: trade, craft"* listing tools the character hasn't recently used.
- **Round-robin rotation**: Background/dormant tiers only get a subset of tools per tick, cycling through the full set over time to ensure coverage.

**Fix:**

1. Make sure all tool descriptions are roughly equal in specificity and appeal. If `talk_to` says "Talk to anyone about anything" but `trade` says "trade", the model will always pick the descriptive one.
2. Check the tool distribution output in the simulation runner — if one tool is >30%, its description likely needs to be less generic or other tools need more detail.
3. The engine self-corrects over time via the mechanisms above. Run for more ticks to see the rebalancing effect.

---

## 3. Tool Calls Have Wrong Arguments

**Symptom:** Tool calls succeed but with unexpected argument values — wrong types, out-of-range numbers, or free-text where an enum was expected.

**Causes:**

- **LLM guessing.** Small models may output `"amount": "five"` instead of `"amount": 5`, or invent enum values.
- **Missing enum constraints.** Free-text parameters invite creative (incorrect) values.

**Engine mechanism:**
- `ToolValidator` (`src/tools/ToolValidator.ts:81-102`) validates and coerces every parameter:
  - **String→Number coercion** (`src/tools/ToolValidator.ts:134-169`): `"5"` becomes `5`, `"five"` triggers an error.
  - **Range clamping** (`src/tools/ToolValidator.ts:156-158`): If a number exceeds `min`/`max`, it's silently clamped to the boundary instead of rejected.
  - **Enum validation** (`src/tools/ToolValidator.ts:104-132`): If a value doesn't match allowed enums, the call fails gracefully.
  - **Array coercion** (`src/tools/ToolValidator.ts:187-205`): A comma-separated string like `"a,b,c"` is split into `["a","b","c"]`.

**Fix:**

1. **Use enums wherever possible.** Instead of `type: 'string'` for a location parameter, provide `enum: ['north', 'south', 'east', 'west']`. This constrains the LLM and makes validation simple.
2. **Add `min`/`max` to number parameters.** The validator will clamp silently rather than rejecting.
3. **Keep parameter names obvious.** `target` is better than `t`, `amount` is better than `n`.
4. **Order parameters from most to least important.** The model pays more attention to the first parameters.

---

## 4. Characters Narrate Instead of Acting

**Symptom:** Model output looks like `*The knight draws his sword and looks around the room*` or `"What should we do next, captain?"` instead of a JSON tool call.

**Causes:**

- **Model not trained for tool calling.** General chat models default to roleplay/narration.
- **Prompt leaking.** World rules or backstory might be too "story-like", encouraging narrative responses.

**Engine mechanism:**
- `looksLikeNarration()` (`src/agent/AgentRunner.ts:818-852`) uses 9 heuristics to detect narration:
  - Question patterns ("What should", "How about")
  - GM-style text ("Let's see", "The story continues")
  - Third-person narration ("The character walks")
  - Asterisk wrapping (`*action*`)
  - Length >200 characters (tool calls are short)
  - Multiple question marks
  - Scene-setting language
- When narration is detected and tools are available, the **nudge retry** (`src/agent/AgentRunner.ts:355-383`) appends a system message forcing JSON output and re-queries the model.

**Fix:**

1. Switch to xLAM-2-1B — it's trained to output JSON tool calls, not prose.
2. Keep `getWorldRules()` concise and action-oriented. End with "Be concise." to discourage verbosity.
3. Check `speechStyle` in character identities — avoid phrases like "tells stories" or "describes scenes in detail".

---

## 5. Malformed JSON from LLM

**Symptom:** Logs show JSON parse errors, but the raw output looks almost correct (e.g., single quotes, trailing commas).

**Causes:**

- Small models frequently produce almost-valid JSON with minor syntax issues.

**Engine mechanism:**
- `fuzzyParseToolCall()` (`src/agent/AgentRunner.ts:858-885`) attempts progressive repairs:
  1. Replace single quotes with double quotes
  2. Remove trailing commas before `}` or `]`
  3. Add quotes around unquoted object keys
  4. Extract tool name from `parsed.tool`, `parsed.name`, or `parsed.action`
- If fuzzy parsing also fails, the output degrades gracefully to a dialogue action.

**Fix:**

This is mostly handled automatically. If you see excessive parse failures:
1. Check `diagnose.ts` output to categorize failure types.
2. Ensure the model is producing output in the right format — xLAM models produce clean JSON.
3. If using a custom model, verify it supports the `{"tool": "name", "arguments": {...}}` format in its training data.

---

## 6. Using diagnose.ts

The diagnostic script (`examples/game-simulations/diagnose.ts`) runs characters against your live LLM and categorizes every response.

**How to run:**
```bash
npx tsx examples/game-simulations/diagnose.ts
```
Requires vLLM running at port 8100 (or configure via `--port`).

**Output sections:**

| Section | What it shows |
|---|---|
| Response categories | Counts of valid_json_tool, narration, malformed_json, empty_response, etc. (10 category heuristics, lines 41-80) |
| Per-archetype breakdown | Tool call rate for each archetype (lines 366-386) — helps identify if certain personalities are problematic |
| Token efficiency | Tokens used per successful tool call vs. wasted on failures (lines 349-364) |
| Tool hallucination | Cases where the model invents tool names that don't exist (lines 323-347) |

**Interpreting results:**

- **>80% valid_json_tool** = model is working well
- **High narration %** = model isn't tool-call trained, or prompts are too narrative
- **High malformed_json %** = model tries but can't produce clean JSON — fuzzyParseToolCall handles most of these
- **Tool hallucination** = model invents tools not in the prompt — use shorter, clearer tool names

---

## 7. Model Selection Guide

Tested across 10 models. Results from stress tests with 32 characters.

| Model | Size | Tool Rate | Throughput | Verdict |
|---|---|---|---|---|
| **xLAM-2-1B** (Salesforce) | ~2GB FP16 | High (5-6 tools used) | 11.91 dec/s | **Best choice** — trained for function calling |
| Qwen2.5-1.5B | ~1.6GB | 18% tools / 82% dialogue | 3.02 dec/s | Runner-up — fast but dialogue-heavy |
| 8B+ models (Llama, etc.) | 8-16GB | Varies | <1 dec/s | Too slow for real-time (>10s latency) |

**Key findings:**

- **FP16 safetensors >> GGUF**: 6x throughput improvement (11.91 vs 2.00 dec/s). Always use FP16 safetensors with vLLM when possible.
- **Size isn't everything.** A 1B model trained for tool calling beats a 7B general-purpose model at this task.
- **vLLM continuous batching** is critical for throughput. LM Studio doesn't truly parallelize.
- Full benchmark results: `examples/stress-test/results/`

---

## 8. Tool Description Best Practices

The `PromptBuilder` formats tools as `- name(params) — description` (`src/agent/PromptBuilder.ts:296-309`). Small models have limited attention, so every word counts.

**Guidelines:**

| Do | Don't |
|---|---|
| `"Search a location for physical evidence"` | `"This tool allows the agent to search"` |
| Use active verbs: "Repair", "Scan", "Trade" | Passive voice: "Can be used to repair" |
| Keep under 15 words | Write a paragraph |
| Use enums: `enum: ['north', 'south', 'east', 'west']` | Free text: `"Enter a direction"` |
| Name tools with clear verbs: `repair_ship`, `fire_cannons` | Vague names: `do_action`, `process` |

**Parameter tips:**

1. **Put the most important parameter first.** Models pay more attention to earlier parameters.
2. **Use enums for any closed set.** Even 10+ values in an enum is better than free text.
3. **Don't cross-reference tools** in descriptions (e.g., "Use after calling scan"). The model sees tools independently.
4. **Match description specificity.** If one tool has a 3-word description and another has 15 words, the model will favor the detailed one.

---

## 9. Token Budget Impact

Character activity tiers have different context budgets. Understanding these helps diagnose why characters behave differently.

**Tier budgets:**

| Tier | Context Tokens | Response Tokens | Max Tools | Tool Selection |
|---|---|---|---|---|
| Active | 800 | 150 | 6 | All available |
| Background | 400 | 100 | 2 | Round-robin rotated |
| Dormant | 250 | 80 | 1 | Round-robin rotated |

**What gets cut first (in order):**

1. Variety hints (ContextAssembler)
2. Extension data (emotions, goals, relationships) — only injected if budget allows
3. Episodic memories (fewer included)
4. World state details

**Context-size retry:**
If the LLM returns an error due to context length, the engine automatically retries with a reduced context. This is part of the error recovery system (expansion 26-28).

**Tuning knobs:**

- `config.tick.batchSize` — how many characters process per tick
- `config.inference.maxConcurrency` — parallel LLM requests (default 64 for vLLM)
- Character `initialCloseness` — determines starting tier (higher = more active = bigger budget)
- Tool count per plugin — each tool costs ~20-40 tokens in the prompt. 6 tools is the sweet spot; 10+ tools will crowd out other context.
