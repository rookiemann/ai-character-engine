#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Model Benchmark Runner
# Starts vLLM with each model, runs stress test, collects results.
#
# Usage: bash examples/stress-test/benchmark.sh
# ═══════════════════════════════════════════════════════════════

# Configure these paths for your environment
VLLM_DIR="${VLLM_DIR:-/path/to/vllm/environment}"
VLLM_PYTHON="${VLLM_PYTHON:-$VLLM_DIR/Scripts/python.exe}"
VLLM_LAUNCHER="${VLLM_LAUNCHER:-$VLLM_DIR/vllm_launcher.py}"
PORT=8100
RESULTS_DIR="examples/stress-test/results"
CHARS=6
TICKS=10

mkdir -p "$RESULTS_DIR"

# Model name → GGUF path mapping
# Update these paths to point to your local model files
MODEL_DIR="${MODEL_DIR:-/path/to/models}"
declare -A MODELS
MODELS=(
  ["qwen2.5-7b-uncensored"]="$MODEL_DIR/Qwen2.5-7B-Instruct-Uncensored_Q4_K_M.gguf"
  ["granite-3.3-8b"]="$MODEL_DIR/granite-3.3-8b-instruct-Q6_K.gguf"
  ["ministral-3b"]="$MODEL_DIR/Ministral-3-3B-Instruct-2512-Q8_0.gguf"
  ["bitnet-2b"]="$MODEL_DIR/ggml-model-i2_s.gguf"
  ["llama-3.2-3b"]="$MODEL_DIR/Llama-3.2-3B-Instruct-Q8_0.gguf"
  ["llama-3.2-11b-vision"]="$MODEL_DIR/Llama-3.2-11B-Vision-Instruct.Q4_K_M.gguf"
  ["qwen2.5-1.5b"]="$MODEL_DIR/qwen2.5-1.5b-instruct-q8_0.gguf"
)

# Order for running (smallest first for quick wins)
ORDER=(
  "qwen2.5-1.5b"
  "bitnet-2b"
  "ministral-3b"
  "llama-3.2-3b"
  "qwen2.5-7b-uncensored"
  "granite-3.3-8b"
  "llama-3.2-11b-vision"
)

kill_vllm() {
  # Kill any existing vLLM on port
  local pids=$(lsof -ti:$PORT 2>/dev/null || netstat -ano 2>/dev/null | grep ":$PORT " | grep LISTENING | awk '{print $5}' | sort -u)
  if [ -n "$pids" ]; then
    echo "  Stopping existing vLLM (PIDs: $pids)..."
    for pid in $pids; do
      taskkill //F //PID "$pid" 2>/dev/null || kill "$pid" 2>/dev/null
    done
    sleep 3
  fi
}

wait_for_vllm() {
  local max_wait=180  # 3 minutes max
  local waited=0
  while [ $waited -lt $max_wait ]; do
    if curl -s "http://127.0.0.1:$PORT/v1/models" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
    echo -ne "\r  Waiting for vLLM... ${waited}s"
  done
  echo ""
  return 1
}

echo "╔══════════════════════════════════════════════════════════╗"
echo "║         Model Benchmark Runner                          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo "  Models: ${#ORDER[@]}"
echo "  Chars: $CHARS, Ticks: $TICKS"
echo "  Results: $RESULTS_DIR/"
echo ""

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SUMMARY_FILE="$RESULTS_DIR/summary_${TIMESTAMP}.txt"
echo "Model Benchmark Results - $(date)" > "$SUMMARY_FILE"
echo "========================================" >> "$SUMMARY_FILE"
echo "" >> "$SUMMARY_FILE"

for model_name in "${ORDER[@]}"; do
  model_path="${MODELS[$model_name]}"
  result_file="$RESULTS_DIR/${model_name}_${TIMESTAMP}.txt"

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Model: $model_name"
  echo "  Path:  $model_path"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Check file exists
  if [ ! -f "$model_path" ]; then
    echo "  SKIP: File not found"
    echo "[$model_name] SKIPPED - file not found" >> "$SUMMARY_FILE"
    continue
  fi

  # Kill existing vLLM
  kill_vllm

  # Determine max-model-len based on model size
  MAX_LEN=8192
  GPU_MEM=0.7
  case "$model_name" in
    *11b*|*8b*) MAX_LEN=8192; GPU_MEM=0.8 ;;
    *3b*|*2b*|*1.5b*) MAX_LEN=8192; GPU_MEM=0.5 ;;
  esac

  # Start vLLM
  echo "  Starting vLLM (max_len=$MAX_LEN, gpu_mem=$GPU_MEM)..."
  CUDA_VISIBLE_DEVICES=0 \
  VLLM_ATTENTION_BACKEND=FLASH_ATTN \
  VLLM_HOST_IP=127.0.0.1 \
  "$VLLM_PYTHON" "$VLLM_LAUNCHER" \
    --model "$model_path" \
    --port $PORT \
    --gpu-memory-utilization $GPU_MEM \
    --max-num-seqs 64 \
    --max-model-len $MAX_LEN \
    --enforce-eager \
    --gpu-id 0 \
    > "$RESULTS_DIR/${model_name}_vllm_${TIMESTAMP}.log" 2>&1 &

  VLLM_PID=$!
  echo "  vLLM PID: $VLLM_PID"

  # Wait for vLLM to be ready
  if ! wait_for_vllm; then
    echo "  FAIL: vLLM did not start within 3 minutes"
    echo "[$model_name] FAILED - vLLM did not start" >> "$SUMMARY_FILE"
    kill $VLLM_PID 2>/dev/null
    continue
  fi
  echo ""
  echo "  vLLM ready!"

  # Run stress test
  echo "  Running stress test..."
  cd "$(dirname "$0")/../.."
  npx tsx examples/stress-test/index.ts \
    --vllm --chars=$CHARS --ticks=$TICKS --port=$PORT \
    2>&1 | tee "$result_file"

  echo "" >> "$SUMMARY_FILE"
  echo "[$model_name]" >> "$SUMMARY_FILE"
  # Extract key metrics from result
  grep -E "Duration:|Total decisions:|Throughput:|Avg latency:|p50|p95|Errors:|dialogue:|idle:|move_to:|talk_to:|trade:|fight:|investigate:|rest:|World facts:|Groups:|Tools:" "$result_file" >> "$SUMMARY_FILE" 2>/dev/null
  echo "" >> "$SUMMARY_FILE"

  echo ""
  echo "  Done: $model_name"
  echo ""
done

# Final cleanup
kill_vllm

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Benchmark complete! Summary: $SUMMARY_FILE"
echo "═══════════════════════════════════════════════════════════"
cat "$SUMMARY_FILE"
