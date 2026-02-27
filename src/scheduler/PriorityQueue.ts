import type { AgentDecisionRequest } from '../core/types';
import { getLogger } from '../core/logger';

/**
 * Expansion 12: Batch Optimization + Priority Queuing
 *
 * Priority queue for agent decision requests.
 * Active-tier agents and event-triggered requests get priority.
 * Deduplicates requests for the same character.
 */
export class PriorityQueue {
  private queue: PrioritizedRequest[] = [];
  private seen = new Set<string>();
  private log = getLogger('priority-queue');

  /**
   * Add a request to the queue.
   */
  enqueue(request: AgentDecisionRequest, priority?: number): void {
    // Deduplicate by characterId
    if (this.seen.has(request.characterId)) {
      this.log.debug({ characterId: request.characterId }, 'Deduplicated request');
      return;
    }

    const computedPriority = priority ?? this.computePriority(request);
    this.queue.push({ request, priority: computedPriority });
    this.seen.add(request.characterId);

    // Keep sorted by priority (highest first)
    this.queue.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Add multiple requests.
   */
  enqueueAll(requests: AgentDecisionRequest[]): void {
    for (const req of requests) {
      this.enqueue(req);
    }
  }

  /**
   * Dequeue the highest-priority batch.
   */
  dequeueBatch(size: number): AgentDecisionRequest[] {
    const batch = this.queue.splice(0, size);
    for (const item of batch) {
      this.seen.delete(item.request.characterId);
    }
    return batch.map(item => item.request);
  }

  /**
   * Dequeue all items.
   */
  dequeueAll(): AgentDecisionRequest[] {
    const all = this.queue.map(item => item.request);
    this.queue = [];
    this.seen.clear();
    return all;
  }

  /**
   * Peek at the queue without removing.
   */
  peek(count: number = 5): AgentDecisionRequest[] {
    return this.queue.slice(0, count).map(item => item.request);
  }

  /**
   * Get queue size.
   */
  get size(): number {
    return this.queue.length;
  }

  /**
   * Check if empty.
   */
  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Clear the queue.
   */
  clear(): void {
    this.queue = [];
    this.seen.clear();
  }

  /**
   * Compute priority for a request.
   * Higher = more important.
   */
  private computePriority(request: AgentDecisionRequest): number {
    let priority = 0;

    // Event-triggered requests get highest priority
    if (request.triggerEvent) {
      priority += 50;
      priority += (request.triggerEvent.importance ?? 5) * 5;
    }

    // Energy level (activity tier proxy)
    priority += request.energyLevel * 20;

    return priority;
  }
}

interface PrioritizedRequest {
  request: AgentDecisionRequest;
  priority: number;
}
