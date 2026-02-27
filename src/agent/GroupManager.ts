import type {
  CharacterGroup,
  GroupDecision,
  CharacterState,
  ToolCall,
  DialogueAction,
  IdleAction,
  AgentDecisionResult,
  Persistable,
} from '../core/types';
import type { StateRepository } from '../db/repositories/StateRepository';
import { AgentRegistry } from './AgentRegistry';
import { getLogger } from '../core/logger';

/**
 * Expansion 10: Group Behaviors
 *
 * Manages character groups for coordinated decision-making.
 * Groups vote on actions and the consensus determines behavior.
 */
export class GroupManager implements Persistable {
  private groups = new Map<string, CharacterGroup>();
  private log = getLogger('group-manager');

  constructor(private registry: AgentRegistry) {}

  /**
   * Create a character group.
   */
  createGroup(
    name: string,
    memberIds: string[],
    purpose: string,
    leaderId?: string,
  ): CharacterGroup {
    const id = `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const group: CharacterGroup = {
      id,
      name,
      memberIds,
      leaderId: leaderId ?? memberIds[0],
      purpose,
      cohesion: 0.7,
      createdAt: Date.now(),
    };

    this.groups.set(id, group);
    this.log.info({ id, name, members: memberIds.length }, 'Group created');
    return group;
  }

  /**
   * Add a member to a group.
   */
  addMember(groupId: string, characterId: string): void {
    const group = this.groups.get(groupId);
    if (!group) return;
    if (!group.memberIds.includes(characterId)) {
      group.memberIds.push(characterId);
      // Slightly reduce cohesion when new members join
      group.cohesion = Math.max(0.3, group.cohesion - 0.05);
    }
  }

  /**
   * Remove a member from a group.
   */
  removeMember(groupId: string, characterId: string): void {
    const group = this.groups.get(groupId);
    if (!group) return;
    group.memberIds = group.memberIds.filter(id => id !== characterId);
    if (group.leaderId === characterId) {
      group.leaderId = group.memberIds[0];
    }
  }

  /**
   * Get a group by ID.
   */
  get(groupId: string): CharacterGroup | undefined {
    return this.groups.get(groupId);
  }

  /**
   * Get all groups a character belongs to.
   */
  getCharacterGroups(characterId: string): CharacterGroup[] {
    return [...this.groups.values()].filter(g =>
      g.memberIds.includes(characterId),
    );
  }

  /**
   * Resolve a group decision from individual decision results.
   * Uses voting: each character's action is a vote.
   */
  resolveGroupDecision(
    groupId: string,
    individualResults: AgentDecisionResult[],
  ): GroupDecision | null {
    const group = this.groups.get(groupId);
    if (!group) return null;

    const votes: Record<string, string> = {};
    const actionCounts = new Map<string, number>();

    for (const result of individualResults) {
      const actionKey = this.actionKey(result.action);
      votes[result.characterId] = actionKey;
      actionCounts.set(actionKey, (actionCounts.get(actionKey) ?? 0) + 1);
    }

    // Find the most popular action
    let topAction = '';
    let topCount = 0;
    for (const [action, count] of actionCounts) {
      if (count > topCount) {
        topAction = action;
        topCount = count;
      }
    }

    // Find the actual action object from the winning vote
    const winningResult = individualResults.find(r =>
      this.actionKey(r.action) === topAction,
    );

    if (!winningResult) return null;

    const consensus = topCount / individualResults.length;

    // Leader's vote breaks ties or provides small bonus
    const leaderResult = individualResults.find(r => r.characterId === group.leaderId);
    const leaderAgreed = leaderResult && this.actionKey(leaderResult.action) === topAction;
    const adjustedConsensus = leaderAgreed ? Math.min(1, consensus + 0.1) : consensus;

    // Update group cohesion based on consensus
    group.cohesion = group.cohesion * 0.8 + adjustedConsensus * 0.2;

    return {
      groupId,
      action: winningResult.action,
      votes,
      consensus: adjustedConsensus,
    };
  }

  /**
   * Get group prompt text for context injection.
   */
  getGroupPrompt(characterId: string): string | null {
    const groups = this.getCharacterGroups(characterId);
    if (groups.length === 0) return null;

    const lines = groups.map(g => {
      const isLeader = g.leaderId === characterId;
      const memberNames = g.memberIds
        .filter(id => id !== characterId)
        .map(id => this.registry.get(id)?.name ?? id)
        .slice(0, 4);
      return `- ${g.name}: ${g.purpose} (${isLeader ? 'leader' : 'member'}, with ${memberNames.join(', ')})`;
    });

    return `Groups:\n${lines.join('\n')}`;
  }

  /**
   * Disband a group.
   */
  disband(groupId: string): void {
    this.groups.delete(groupId);
  }

  /**
   * Get all groups.
   */
  getAll(): CharacterGroup[] {
    return [...this.groups.values()];
  }

  saveState(repo: StateRepository): void {
    const data: Array<{
      id: string; name: string; memberIds: string; leaderId?: string;
      purpose: string; cohesion: number; createdAt: number;
    }> = [];
    for (const group of this.groups.values()) {
      data.push({
        id: group.id,
        name: group.name,
        memberIds: JSON.stringify(group.memberIds),
        leaderId: group.leaderId,
        purpose: group.purpose,
        cohesion: group.cohesion,
        createdAt: group.createdAt,
      });
    }
    repo.clearGroups();
    if (data.length > 0) repo.saveGroups(data);
  }

  loadState(repo: StateRepository): void {
    const rows = repo.loadAllGroups();
    this.groups.clear();
    for (const r of rows) {
      this.groups.set(r.id, {
        id: r.id,
        name: r.name,
        memberIds: JSON.parse(r.memberIds),
        leaderId: r.leaderId,
        purpose: r.purpose,
        cohesion: r.cohesion,
        createdAt: r.createdAt,
      });
    }
    this.log.debug({ count: rows.length }, 'Groups loaded from DB');
  }

  private actionKey(action: ToolCall | DialogueAction | IdleAction): string {
    if ('toolName' in action) return `tool:${(action as ToolCall).toolName}`;
    if ('content' in action) return 'dialogue';
    return 'idle';
  }
}
