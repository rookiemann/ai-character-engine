import type { CharacterGoal, GoalStep, GoalStatus, CharacterState, Persistable } from '../core/types';
import type { StateRepository } from '../db/repositories/StateRepository';
import { getLogger } from '../core/logger';

/**
 * Expansion 7: Goal Planning System
 *
 * Characters can have multi-step goals that guide their behavior.
 * Goals decompose into steps and influence tool selection.
 */
export class GoalPlanner implements Persistable {
  private goals = new Map<string, CharacterGoal[]>(); // characterId → goals
  private log = getLogger('goal-planner');

  /**
   * Add a goal for a character.
   */
  addGoal(
    characterId: string,
    description: string,
    priority: number = 5,
    steps: GoalStep[] = [],
    parentGoalId?: string,
  ): CharacterGoal {
    const id = `goal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const goal: CharacterGoal = {
      id,
      characterId,
      description,
      priority: Math.max(1, Math.min(10, priority)),
      status: 'pending',
      steps,
      parentGoalId,
      createdAt: Date.now(),
    };

    const existing = this.goals.get(characterId) ?? [];
    existing.push(goal);
    this.goals.set(characterId, existing);

    this.log.debug({ characterId, goalId: id, description }, 'Goal added');
    return goal;
  }

  /**
   * Activate a goal (set status to active).
   */
  activateGoal(goalId: string): void {
    const goal = this.findGoal(goalId);
    if (goal && goal.status === 'pending') {
      goal.status = 'active';
    }
  }

  /**
   * Complete a step in a goal.
   */
  completeStep(goalId: string, stepIndex: number): void {
    const goal = this.findGoal(goalId);
    if (!goal || stepIndex >= goal.steps.length) return;

    goal.steps[stepIndex].completed = true;

    // Check if all steps completed → complete the goal
    if (goal.steps.every(s => s.completed)) {
      goal.status = 'completed';
      goal.completedAt = Date.now();
      this.log.info({ goalId, characterId: goal.characterId }, 'Goal completed');
    }
  }

  /**
   * Update a goal's status.
   */
  updateStatus(goalId: string, status: GoalStatus): void {
    const goal = this.findGoal(goalId);
    if (goal) {
      goal.status = status;
      if (status === 'completed' || status === 'failed' || status === 'abandoned') {
        goal.completedAt = Date.now();
      }
    }
  }

  /**
   * Get active goals for a character, sorted by priority.
   */
  getActiveGoals(characterId: string): CharacterGoal[] {
    const goals = this.goals.get(characterId) ?? [];
    return goals
      .filter(g => g.status === 'active' || g.status === 'pending')
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get all goals for a character.
   */
  getAllGoals(characterId: string): CharacterGoal[] {
    return this.goals.get(characterId) ?? [];
  }

  /**
   * Get the current step that needs work for the highest-priority active goal.
   */
  getCurrentObjective(characterId: string): { goal: CharacterGoal; step: GoalStep; stepIndex: number } | null {
    const active = this.getActiveGoals(characterId).filter(g => g.status === 'active');
    if (active.length === 0) return null;

    const goal = active[0]; // Highest priority
    const stepIndex = goal.steps.findIndex(s => !s.completed);
    if (stepIndex === -1) return null;

    return { goal, step: goal.steps[stepIndex], stepIndex };
  }

  /**
   * Get goal prompt text for context injection.
   */
  getGoalPrompt(characterId: string): string | null {
    const active = this.getActiveGoals(characterId);
    if (active.length === 0) return null;

    const lines = active.slice(0, 3).map(g => {
      const completedSteps = g.steps.filter(s => s.completed).length;
      const progress = g.steps.length > 0
        ? ` (${completedSteps}/${g.steps.length} steps done)`
        : '';
      return `- [P${g.priority}] ${g.description}${progress}`;
    });

    const current = this.getCurrentObjective(characterId);
    let currentLine = '';
    if (current) {
      currentLine = `\nImmediate objective: ${current.step.description}`;
      if (current.step.toolName) {
        currentLine += ` (use ${current.step.toolName})`;
      }
    }

    return `Active goals:\n${lines.join('\n')}${currentLine}`;
  }

  /**
   * Prune old completed/failed goals.
   */
  prune(maxAge: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAge;
    for (const [characterId, goals] of this.goals) {
      const kept = goals.filter(g =>
        g.status === 'active' || g.status === 'pending' ||
        (g.completedAt && g.completedAt > cutoff),
      );
      this.goals.set(characterId, kept);
    }
  }

  /**
   * Clear all goal data for a character.
   */
  clearCharacter(characterId: string): void {
    this.goals.delete(characterId);
  }

  saveState(repo: StateRepository): void {
    const data: Array<{
      id: string; characterId: string; description: string; priority: number;
      status: string; steps: string; parentGoalId?: string; deadline?: number;
      createdAt: number; completedAt?: number;
    }> = [];
    for (const goals of this.goals.values()) {
      for (const g of goals) {
        data.push({
          id: g.id,
          characterId: g.characterId,
          description: g.description,
          priority: g.priority,
          status: g.status,
          steps: JSON.stringify(g.steps),
          parentGoalId: g.parentGoalId,
          deadline: g.deadline,
          createdAt: g.createdAt,
          completedAt: g.completedAt,
        });
      }
    }
    repo.clearGoals();
    if (data.length > 0) repo.saveGoals(data);
  }

  loadState(repo: StateRepository): void {
    const rows = repo.loadAllGoals();
    this.goals.clear();
    for (const r of rows) {
      const goal: CharacterGoal = {
        id: r.id,
        characterId: r.characterId,
        description: r.description,
        priority: r.priority,
        status: r.status as GoalStatus,
        steps: JSON.parse(r.steps),
        parentGoalId: r.parentGoalId,
        deadline: r.deadline,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
      };
      const existing = this.goals.get(r.characterId) ?? [];
      existing.push(goal);
      this.goals.set(r.characterId, existing);
    }
    this.log.debug({ count: rows.length }, 'Goals loaded from DB');
  }

  private findGoal(goalId: string): CharacterGoal | undefined {
    for (const goals of this.goals.values()) {
      const found = goals.find(g => g.id === goalId);
      if (found) return found;
    }
    return undefined;
  }
}
