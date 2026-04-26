# AI Character Engine -- vLLM on Windows

## Overview

vLLM is the **recommended production provider** for the AI Character Engine due to its continuous batching architecture, which delivers the highest throughput for concurrent agent inference. The engine includes an enhanced launcher (`vllm_launcher.py`) that adds async batching, tool calling support, embedding endpoints, GPU pinning, and CORS headers on top of the standard vLLM server.

**Key capabilities:**
- Continuous batching: processes many agent requests simultaneously without head-of-line blocking
- Tool calling: native chat template support with text fallback for function calling
- Embedding endpoint: `/v1/embeddings` for semantic memory retrieval
- GPU pinning: `--gpu-id` flag to assign specific GPUs
- Prefix caching: reuse KV cache across requests with shared prompt prefixes
- Adaptive polling: 1ms busy / 3ms idle for low-latency response delivery

---

## Pre-Built Windows Environment

Building vLLM from source on Windows is non-trivial. A ready-to-use build with the enhanced launcher, patches, and setup instructions is available at:

**https://github.com/aivrar/vllm-windows-build**

If you prefer to build from source, see the prerequisites and instructions below.

## Prerequisites

- **Operating System:** Windows 10 or Windows 11
- **CUDA:** 12.6 or later
- **Python:** 3.10 (must match the vLLM environment)
- **Visual Studio Build Tools:** Required for compiling CUDA extensions
- **GPU:** NVIDIA GPU with sufficient VRAM (recommended: 12GB+ for 1-2B models, 24GB for 7B+ models)

---

## Launching the Inference Server

The inference server handles LLM completions and tool calling for agent decisions.

### Launch Command

```bash
cd /path/to/vllm/environment
CUDA_VISIBLE_DEVICES=0 VLLM_ATTENTION_BACKEND=FLASH_ATTN VLLM_HOST_IP=127.0.0.1 \
  python vllm_launcher.py \
  --model "Salesforce/xLAM-2-1b-fc-r" \
  --port 8100 \
  --gpu-memory-utilization 0.92 \
  --max-num-seqs 128 \
  --max-model-len 4096 \
  --enable-prefix-caching \
  --enforce-eager \
  --gpu-id 0
```

### Parameter Breakdown

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `CUDA_VISIBLE_DEVICES=0` | GPU index | Restrict to GPU 0 |
| `VLLM_ATTENTION_BACKEND=FLASH_ATTN` | Backend | Use Flash Attention for performance |
| `VLLM_HOST_IP=127.0.0.1` | Bind address | Local-only access |
| `--model` | Model path | Path to the model directory (FP16 safetensors) |
| `--port 8100` | Port | HTTP API port |
| `--gpu-memory-utilization 0.92` | 0.0-1.0 | Fraction of GPU VRAM to use |
| `--max-num-seqs 128` | Integer | Maximum concurrent sequences (batch size) |
| `--max-model-len 4096` | Tokens | Maximum context length per request |
| `--enable-prefix-caching` | Flag | Reuse KV cache for shared prompt prefixes |
| `--enforce-eager` | Flag | **REQUIRED on Windows** -- disables CUDA graphs |
| `--gpu-id 0` | GPU index | Pin to specific GPU device |

---

## Launching the Embedding Server

A separate vLLM instance can run on a different GPU to serve embedding requests for semantic memory.

### Launch Command

```bash
cd /path/to/vllm/environment
CUDA_VISIBLE_DEVICES=1 VLLM_HOST_IP=127.0.0.1 \
  python vllm_launcher.py \
  --model "nomic-ai/nomic-embed-text-v1.5" \
  --task embed \
  --trust-remote-code \
  --gpu-id 1 \
  --port 8101 \
  --enforce-eager
```

### Embedding-Specific Parameters

| Parameter | Purpose |
|-----------|---------|
| `--task embed` | Run in embedding mode, exposes `/v1/embeddings` endpoint |
| `--trust-remote-code` | Required for some embedding models (e.g., nomic) |
| `--gpu-id 1` | Pin to GPU 1 (separate from inference) |
| `--port 8101` | Different port from inference server |

### Engine Configuration for Embeddings

```json
{
  "embedding": {
    "type": "vllm",
    "baseUrl": "http://127.0.0.1:8101/v1",
    "models": {
      "heavy": "nomic-embed-text-v1.5",
      "mid": "nomic-embed-text-v1.5",
      "light": "nomic-embed-text-v1.5"
    },
    "maxConcurrency": 4,
    "timeoutMs": 10000
  }
}
```

---

## Windows-Specific Constraints

### --enforce-eager is REQUIRED

On Windows, Triton is not available, which means CUDA graphs cannot be compiled. The `--enforce-eager` flag disables CUDA graph optimization and uses eager execution instead. **Without this flag, vLLM will fail to start on Windows.**

### --gpu-memory-utilization: Maximum 0.92

The Windows display driver reserves approximately 80MB of VRAM for desktop compositing, even on GPUs not connected to a display. Setting `--gpu-memory-utilization` above 0.92 risks OOM errors.

**Recommended values:**
- 0.92 for a dedicated inference GPU
- 0.85 for a GPU that is also running other tasks
- 0.80 for conservative/safe operation

### DO NOT use CUDA_DEVICE_ORDER=PCI_BUS_ID

On some systems (including the development machine for this project), setting `CUDA_DEVICE_ORDER=PCI_BUS_ID` flips the GPU indices. If GPU 0 is your RTX 3090 and GPU 1 is your RTX 3060, this environment variable may swap them. Avoid it unless you have verified your GPU ordering.

### better-sqlite3 Build Note

If using Node.js v24, `better-sqlite3` may require a manual build. If the Windows SDK 10.0.26100.0 is not installed, you may need to patch the `.vcxproj` file to target Windows SDK 10.0.19041.0 and build with MSBuild directly.

---

## Performance Tuning

### Concurrent Sequences (--max-num-seqs)

This controls how many agent requests can be processed simultaneously in a single batch. Higher values increase throughput but consume more VRAM.

| Value | Use Case |
|-------|----------|
| 16 | Small GPU (8GB), few characters |
| 64 | Medium GPU (12GB), moderate character count |
| 128 | Large GPU (24GB), many characters (recommended for 32+ characters) |

### GPU Memory Utilization

Controls what fraction of total VRAM vLLM can allocate for the KV cache and model weights.

| Value | Use Case |
|-------|----------|
| 0.80 | Conservative, shared GPU |
| 0.85 | Standard workload |
| 0.90 | High throughput |
| 0.92 | Maximum on Windows (display driver overhead) |

### Context Length (--max-model-len)

Maximum number of tokens per request. Longer contexts consume more KV cache memory, reducing the number of concurrent sequences.

| Value | Use Case |
|-------|----------|
| 2048 | Minimal context, maximum concurrency |
| 4096 | Recommended for tool-calling models |
| 8192 | Extended context (requires more VRAM) |

### Prefix Caching (--enable-prefix-caching)

When enabled, vLLM caches the KV values for shared prompt prefixes. Since many agent prompts share the same system prompt template, this significantly reduces computation for repeated requests. **Always enable this for the AI Character Engine.**

### Scheduler Steps

The launcher's adaptive polling uses 1ms intervals when busy and 3ms when idle. This provides low latency without excessive CPU usage during quiet periods.

---

## FP16 Safetensors vs GGUF

**FP16 safetensors delivers approximately 6x the throughput of GGUF models** on vLLM.

| Format | Throughput (32 chars) | Notes |
|--------|----------------------|-------|
| FP16 safetensors | 11.91 decisions/sec | Optimal for vLLM |
| GGUF | 2.00 decisions/sec | Works for causal LMs only |

**Important:** GGUF format does **NOT** work for BERT-based embedding models (e.g., nomic-embed). Always use FP16 safetensors for embedding models.

### Why safetensors is faster

- vLLM's continuous batching engine is optimized for the safetensors format
- GGUF quantization adds a dequantization step on every forward pass
- GGUF disables some of vLLM's memory management optimizations
- For small models (1-2B parameters), FP16 fits comfortably in 24GB VRAM, making quantization unnecessary

---

## Benchmark Results

Testing with the xLAM-2-1B model (Salesforce/xLAM-2-1b-fc-r) in FP16 safetensors format:

| Metric | Value |
|--------|-------|
| Model | xLAM-2-1B (FP16 safetensors, ~2GB) |
| GPU | RTX 3090 (24GB) |
| Decisions per second | 11.91 |
| Tokens per second | 16,350 |
| Character count | 32 |
| Concurrent requests | 64 |
| Total decisions | 668 |
| Errors | 0 |
| Tool types used | 5 |
| Median latency (p50) | 4.6 seconds |
| Max sequences | 128 |
| GPU memory utilization | 0.92 |
| Context length | 4096 |

### Comparison with Other Models

| Model | Size | Throughput | Tool Balance | Notes |
|-------|------|-----------|-------------|-------|
| xLAM-2-1B | 2GB | 11.91 dec/s | Good (5 types) | Best overall |
| Qwen2.5-1.5B | 1.6GB | 3.02 dec/s | Poor (18% tools) | Fast but dialogue-heavy |
| Most 8B+ models | 16GB+ | < 1 dec/s | Varies | Too slow for real-time |

Full benchmark results are available in `examples/stress-test/results/`.

---

## Two Simultaneous Instances

The engine supports running two vLLM instances on separate GPUs simultaneously:

```
GPU 0 (RTX 3090, 24GB):  Inference server (xLAM-2-1B)    --> port 8100
GPU 1 (RTX 3060, 12GB):  Embedding server (nomic-embed)   --> port 8101
```

### Engine Configuration

```json
{
  "inference": {
    "type": "vllm",
    "baseUrl": "http://127.0.0.1:8100/v1",
    "models": {
      "heavy": "xLAM-2-1b-fc-r",
      "mid": "xLAM-2-1b-fc-r",
      "light": "xLAM-2-1b-fc-r"
    },
    "maxConcurrency": 64,
    "timeoutMs": 60000
  },
  "embedding": {
    "type": "vllm",
    "baseUrl": "http://127.0.0.1:8101/v1",
    "models": {
      "heavy": "nomic-embed-text-v1.5",
      "mid": "nomic-embed-text-v1.5",
      "light": "nomic-embed-text-v1.5"
    },
    "maxConcurrency": 4,
    "timeoutMs": 10000
  }
}
```

---

## VLLMProvider Configuration

The engine's VLLMProvider (`src/inference/providers/VLLMProvider.ts`) is optimized for high-concurrency operation:

| Setting | Default | Description |
|---------|---------|-------------|
| `maxConcurrency` | 64 | Concurrent requests to vLLM (match or exceed `--max-num-seqs`) |
| `timeoutMs` | 60000 | Request timeout (60 seconds) |
| `maxRetries` | 2 | Retries with exponential backoff on transient errors |

The provider includes:
- **Semaphore-based concurrency control** -- prevents overloading the server
- **Exponential backoff retry** -- with error categorization (transient vs permanent)
- **SSE streaming support** -- for real-time token delivery
- **Error categorization** -- distinguishes timeout, rate limit, validation, and server errors

---

## Troubleshooting

### OOM (Out of Memory) Errors

**Symptoms:** Server crashes or returns errors during inference.

**Solutions:**
1. Lower `--gpu-memory-utilization` (try 0.85)
2. Lower `--max-num-seqs` (try 64 or 32)
3. Lower `--max-model-len` (try 2048)
4. Ensure no other processes are using significant VRAM

### Timeout Errors

**Symptoms:** Requests fail with timeout errors after 60 seconds.

**Solutions:**
1. Check that the vLLM server is running and accessible
2. Verify the port matches your engine config
3. Increase `timeoutMs` in the provider config
4. Reduce `--max-num-seqs` if the server is overloaded

### Model Loading Failures

**Symptoms:** Server fails to start with model loading errors.

**Solutions:**
1. Verify the model path is correct and accessible
2. Ensure the model format is FP16 safetensors (not GGUF for embedding models)
3. Check that `--trust-remote-code` is set for models that require it (e.g., nomic)
4. Verify sufficient VRAM for the model size

### GPU Detection Issues

**Symptoms:** Wrong GPU is used, or GPU is not detected.

**Solutions:**
1. Use `CUDA_VISIBLE_DEVICES=N` to explicitly select the GPU
2. Do NOT use `CUDA_DEVICE_ORDER=PCI_BUS_ID` (may flip GPU indices)
3. Verify GPU availability with `nvidia-smi`
4. Check that the `--gpu-id` flag matches `CUDA_VISIBLE_DEVICES`

### Server Starts But Returns Errors

**Symptoms:** Server is running but all inference requests fail.

**Solutions:**
1. Ensure `--enforce-eager` is set (required on Windows)
2. Check the server logs for CUDA errors
3. Verify the model supports the requested `--max-model-len`
4. Try a clean restart (kill any lingering Python processes first)

### High Latency

**Symptoms:** Decisions take much longer than expected.

**Solutions:**
1. Switch from GGUF to FP16 safetensors format (6x improvement)
2. Increase `--max-num-seqs` to allow more concurrent batching
3. Enable `--enable-prefix-caching` for shared prompt prefix reuse
4. Use a smaller model (1-2B parameters for sub-5s latency)
5. Reduce `--max-model-len` to free KV cache memory for more concurrent sequences

---

## Quick Start Checklist

1. Verify prerequisites (CUDA 12.6+, Python 3.10, VS Build Tools)
2. Download or prepare your model in FP16 safetensors format
3. Launch the inference server with `--enforce-eager` and `--enable-prefix-caching`
4. (Optional) Launch embedding server on a separate GPU
5. Configure the engine with `type: "vllm"` and the correct `baseUrl`
6. Run `engine.healthCheck()` to verify connectivity
7. Start the engine and monitor with `engine.getStats()` and `engine.metrics`
