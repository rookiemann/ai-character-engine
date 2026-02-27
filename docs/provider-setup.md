# Provider Setup Guide

The AI Character Engine supports 6 LLM providers. You can use any combination of local and cloud providers, and configure failover chains for production reliability.

All providers are configured through the `inference` section of `EngineConfig`. The engine uses a three-tier model system (`heavy`, `mid`, `light`) to match inference cost to task importance.

---

## Table of Contents

- [Provider Configuration Format](#provider-configuration-format)
- [1. Ollama (Recommended for Getting Started)](#1-ollama-recommended-for-getting-started)
- [2. vLLM (Recommended for Production)](#2-vllm-recommended-for-production)
- [3. LM Studio (GUI-Friendly)](#3-lm-studio-gui-friendly)
- [4. OpenRouter (Cloud, Multi-Model)](#4-openrouter-cloud-multi-model)
- [5. OpenAI (Cloud)](#5-openai-cloud)
- [6. Anthropic (Cloud)](#6-anthropic-cloud)
- [7. Failover Chains](#7-failover-chains)
- [8. Embeddings](#8-embeddings)
- [9. Model Recommendations](#9-model-recommendations)

---

## Provider Configuration Format

Every provider uses the same `ProviderConfig` interface:

```typescript
interface ProviderConfig {
  type: 'ollama' | 'vllm' | 'lmstudio' | 'openrouter' | 'openai' | 'anthropic';
  baseUrl?: string;           // API endpoint (required for local providers)
  apiKey?: string;            // API key (required for cloud providers)
  models: {
    heavy: string;            // Used for active-tier characters (highest quality)
    mid: string;              // Used for background-tier characters
    light: string;            // Used for dormant-tier characters (fastest)
  };
  modelsPool?: {              // Optional: round-robin model pools per tier
    heavy?: string[];
    mid?: string[];
    light?: string[];
  };
  maxConcurrency?: number;    // Max parallel requests (default varies by provider)
  timeoutMs?: number;         // Request timeout in milliseconds
  maxRetries?: number;        // Number of retry attempts on failure
  gpuId?: number;             // GPU device index (informational, for local providers)
}
```

The `models` object maps the engine's three inference tiers to actual model names:

| Tier | Used For | Token Budget | Response Budget |
|------|----------|-------------|-----------------|
| `heavy` | Active characters (closeness >= 60) | 800 tokens | 150 tokens |
| `mid` | Background characters (closeness 20-59) | 400 tokens | 100 tokens |
| `light` | Dormant characters (closeness < 20) | 250 tokens | 80 tokens |

---

## 1. Ollama (Recommended for Getting Started)

Ollama is the easiest way to run local LLMs. It handles model downloading, serving, and GPU acceleration automatically.

### Installation

1. Download and install Ollama from [ollama.com](https://ollama.com).
2. Pull a model:

```bash
ollama pull qwen2.5:7b
```

For a lighter model (faster, less VRAM):

```bash
ollama pull qwen2.5:1.5b
```

3. Ollama auto-starts its API server on first request. No manual server start needed. Default URL: `http://localhost:11434`.

### Configuration

```typescript
const config: EngineConfig = {
  // ...other config...
  inference: {
    type: 'ollama',
    // baseUrl defaults to http://localhost:11434/v1 if omitted
    models: {
      heavy: 'qwen2.5:7b',
      mid: 'qwen2.5:7b',
      light: 'qwen2.5:1.5b',
    },
    maxConcurrency: 4,
    timeoutMs: 30000,
  },
};
```

### Notes

- Ollama extends the LM Studio provider internally (OpenAI-compatible API at `/v1`).
- If `baseUrl` is not specified, it defaults to `http://localhost:11434/v1`.
- Ollama handles model loading/unloading automatically.
- GPU acceleration is automatic if a supported GPU is available.

---

## 2. vLLM (Recommended for Production)

vLLM provides the highest throughput via continuous batching. Benchmarked at **11.91 decisions/second** with 32 concurrent characters.

### Prerequisites

- Python environment with vLLM installed
- A GPU with sufficient VRAM (8GB minimum, 24GB recommended)
- FP16 safetensors model files (6x faster than GGUF format)

### Starting the Server

```bash
python -m vllm.entrypoints.openai.api_server \
  --model <path-to-model> \
  --port 8100 \
  --gpu-memory-utilization 0.90 \
  --max-num-seqs 128 \
  --max-model-len 4096 \
  --enable-prefix-caching
```

### Configuration

```typescript
const config: EngineConfig = {
  // ...other config...
  inference: {
    type: 'vllm',
    baseUrl: 'http://127.0.0.1:8100/v1',
    models: {
      heavy: 'Salesforce/xLAM-2-1b-fc-r',
      mid: 'Salesforce/xLAM-2-1b-fc-r',
      light: 'Salesforce/xLAM-2-1b-fc-r',
    },
    maxConcurrency: 64,
    timeoutMs: 60000,
  },
};
```

### Performance Tips

- **Use FP16 safetensors models**, not GGUF. FP16 provides approximately 6x throughput improvement (11.91 vs 2.00 decisions/second at 32 characters).
- **Enable prefix caching** (`--enable-prefix-caching`) to reduce redundant computation for shared system prompts.
- **Set `maxConcurrency` high** (32-128) to take advantage of continuous batching.
- `gpu-memory-utilization` of 0.90-0.92 is safe for most setups.

### Windows-Specific Notes

- `--enforce-eager` is **required** on Windows (no Triton support for CUDA graphs).
- Maximum `gpu-memory-utilization` on Windows is 0.92 (display driver reserves ~80MB).
- See `docs/vllm-windows.md` for detailed Windows setup instructions.

---

## 3. LM Studio (GUI-Friendly)

LM Studio provides a user-friendly GUI for downloading and running models.

### Setup

1. Download from [lmstudio.ai](https://lmstudio.ai).
2. Open the application and download a model from the built-in model browser.
3. Load the model in the GUI.
4. Enable the local server by toggling the server switch in the UI (default port: 1234).

### Configuration

```typescript
const config: EngineConfig = {
  // ...other config...
  inference: {
    type: 'lmstudio',
    baseUrl: 'http://localhost:1234/v1',
    models: {
      heavy: 'your-model-name',
      mid: 'your-model-name',
      light: 'your-model-name',
    },
    maxConcurrency: 4,
    timeoutMs: 30000,
  },
};
```

### Limitations

- **No real parallel inference.** LM Studio processes requests sequentially even when multiple requests are sent concurrently. Multiple requests share the GPU and are handled one at a time.
- Best suited for development and testing with a small number of characters.
- For production workloads, use vLLM or Ollama instead.

---

## 4. OpenRouter (Cloud, Multi-Model)

OpenRouter provides access to dozens of models from various providers through a single API.

### Setup

1. Sign up at [openrouter.ai](https://openrouter.ai).
2. Generate an API key from your dashboard.

### Configuration

```typescript
const config: EngineConfig = {
  // ...other config...
  inference: {
    type: 'openrouter',
    apiKey: 'sk-or-v1-...',
    models: {
      heavy: 'meta-llama/llama-3-70b-instruct',
      mid: 'meta-llama/llama-3-8b-instruct',
      light: 'mistralai/mistral-7b-instruct',
    },
    maxConcurrency: 10,
    timeoutMs: 30000,
  },
};
```

### COST WARNING

The engine makes **hundreds of LLM calls per minute** when running many characters. Cloud provider costs can accumulate rapidly. At 32 active characters with fast ticks every 2 seconds, you could generate thousands of API calls per hour. Monitor your usage carefully and set spending limits on your account.

---

## 5. OpenAI (Cloud)

### Setup

1. Get an API key from [platform.openai.com](https://platform.openai.com).

### Configuration

```typescript
const config: EngineConfig = {
  // ...other config...
  inference: {
    type: 'openai',
    apiKey: 'sk-...',
    models: {
      heavy: 'gpt-4o',
      mid: 'gpt-4o-mini',
      light: 'gpt-4o-mini',
    },
    maxConcurrency: 10,
    timeoutMs: 30000,
  },
};
```

### COST WARNING

Same warning as OpenRouter. The engine's high call volume makes cloud providers expensive for production use. Consider local providers (Ollama, vLLM) for sustained workloads.

---

## 6. Anthropic (Cloud)

### Setup

1. Get an API key from [console.anthropic.com](https://console.anthropic.com).

### Configuration

```typescript
const config: EngineConfig = {
  // ...other config...
  inference: {
    type: 'anthropic',
    apiKey: 'sk-ant-...',
    models: {
      heavy: 'claude-sonnet-4-20250514',
      mid: 'claude-haiku-4-20250514',
      light: 'claude-haiku-4-20250514',
    },
    maxConcurrency: 10,
    timeoutMs: 30000,
  },
};
```

### COST WARNING

Same as OpenRouter and OpenAI. Use local providers for cost-effective production deployments.

---

## 7. Failover Chains

The engine includes a built-in `FailoverChain` with circuit breaker logic. When the primary provider fails, requests automatically fall through to the next provider.

### How It Works

1. **Circuit breaker states:**
   - `closed` -- Normal operation, requests flow through.
   - `open` -- Provider known-bad, requests are skipped (fast-fail).
   - `half_open` -- Cooldown elapsed; one probe request is allowed to test recovery.

2. **Failure handling:**
   - After 2 consecutive failures, the circuit opens.
   - Cooldown starts at 5 seconds and doubles exponentially (5s, 10s, 20s, 40s...) up to a 120-second cap.
   - After cooldown, one probe request tests if the provider has recovered.

3. **On success:** Circuit closes, failure counter resets, cooldown resets to 5 seconds.

### Configuration Example

The `FailoverChain` is used internally by the `InferenceService`. To set up failover, configure multiple providers:

```typescript
import { FailoverChain } from './src/inference/FailoverChain';

const chain = new FailoverChain();

// Primary: local vLLM (fastest)
chain.addProvider({
  type: 'vllm',
  baseUrl: 'http://127.0.0.1:8100/v1',
  models: { heavy: 'xLAM-2-1b', mid: 'xLAM-2-1b', light: 'xLAM-2-1b' },
  maxConcurrency: 64,
});

// Fallback: Ollama
chain.addProvider({
  type: 'ollama',
  models: { heavy: 'qwen2.5:7b', mid: 'qwen2.5:7b', light: 'qwen2.5:1.5b' },
});

// Last resort: cloud
chain.addProvider({
  type: 'openrouter',
  apiKey: 'sk-or-v1-...',
  models: { heavy: 'meta-llama/llama-3-8b-instruct', mid: 'meta-llama/llama-3-8b-instruct', light: 'meta-llama/llama-3-8b-instruct' },
});

// Check chain status
const status = chain.getStatus();
// Returns: [{ name: 'vllm', state: 'closed', failures: 0, cooldownMs: 5000 }, ...]

// Health check all providers
const health = await chain.healthCheckAll();
// Returns: { vllm: true, ollama: true, openrouter: true }
```

---

## 8. Embeddings

Embeddings are optional and enable semantic memory retrieval. When configured, the `SemanticRetriever` augments the `AgentRunner` to find contextually relevant memories beyond simple tag-based lookup.

### Configuration

Add an `embedding` section to your `EngineConfig`:

```typescript
const config: EngineConfig = {
  // ...other config...
  embedding: {
    type: 'ollama',
    models: {
      heavy: 'nomic-embed-text',
      mid: 'nomic-embed-text',
      light: 'nomic-embed-text',
    },
  },
};
```

### Ollama Embeddings

```bash
ollama pull nomic-embed-text
```

No additional server setup needed. Ollama serves embeddings from the same endpoint.

### vLLM Embeddings

vLLM can serve embedding models as a separate instance:

```bash
python -m vllm.entrypoints.openai.api_server \
  --model <path-to-embedding-model> \
  --task embed \
  --trust-remote-code \
  --port 8101
```

```typescript
embedding: {
  type: 'vllm',
  baseUrl: 'http://127.0.0.1:8101/v1',
  models: {
    heavy: 'nomic-ai/nomic-embed-text-v1.5',
    mid: 'nomic-ai/nomic-embed-text-v1.5',
    light: 'nomic-ai/nomic-embed-text-v1.5',
  },
},
```

### Recommended Embedding Models

- **nomic-embed-text** (Ollama) -- Good general-purpose embeddings, easy setup.
- **nomic-embed-text-v1.5** (safetensors, 768-dim) -- For vLLM. Must use safetensors format; GGUF is not supported for BERT-based embedding models in vLLM.

### Notes

- Embedding is wired automatically when `config.embedding` is present.
- The `MemoryConsolidator` uses embeddings for semantic clustering when available, falling back to tag-only clustering otherwise.
- The `SemanticRetriever` kicks in when SQL-first retrieval returns fewer than 2 episodic memories.

---

## 9. Model Recommendations

Based on extensive benchmarking (10 models tested, results in `examples/stress-test/results/`):

### Best Tested: xLAM-2-1B (Salesforce)

- **Peak performance:** 11.91 decisions/second, 16,350 tokens/second at 32 characters with 64 concurrency
- **Tool calling:** Excellent balance across all tool types (no single tool above 23%)
- **Error rate:** 0 errors across 668 decisions
- **Size:** ~2GB (FP16 safetensors)
- **Best for:** Production deployments where tool calling accuracy matters

### Runner-Up: Qwen2.5-1.5B

- **Throughput:** 3.02 decisions/second (fastest raw throughput in GGUF)
- **Behavior:** 18% tool use, 82% dialogue (leans heavily toward conversation)
- **Size:** ~1.6GB
- **Best for:** Dialogue-heavy games where tool variety is less important

### General Guidance

| Model Size | Pros | Cons |
|-----------|------|------|
| 1-2B parameters | Fast (< 5s latency), low VRAM | Less nuanced reasoning |
| 7B parameters | Better reasoning, good tool use | Higher latency (5-10s) |
| 8B+ parameters | Best reasoning quality | Often too slow (> 10s latency), may cause tick timeouts |

- For **local deployment**, stay at 1-3B parameters to keep latency under 5 seconds per decision.
- For **cloud deployment**, larger models are viable since cloud providers handle the compute, but costs scale linearly with model size.
- **FP16 safetensors** format is strongly recommended over GGUF for vLLM (6x throughput improvement).
- Always test with your specific game's tool set. Some models have strong biases toward certain tool names or patterns.
