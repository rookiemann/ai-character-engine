import type { DelegationOrder } from '../core/types';
import { ChatRepository } from '../db/repositories/ChatRepository';
import { ProximityManager } from './ProximityManager';
import { ProximityError } from '../core/errors';
import { getLogger } from '../core/logger';

/**
 * Manages delegation of authority to close characters.
 * Only characters with closeness >= delegateMinCloseness can receive delegations.
 */
export class DelegationManager {
  private log = getLogger('delegation');

  constructor(
    private chatRepo: ChatRepository,
    private proximity: ProximityManager,
  ) {}

  /**
   * Delegate an instruction to a character.
   */
  delegate(
    characterId: string,
    playerId: string,
    instruction: string,
    scope: string,
    expiresAt?: number,
  ): DelegationOrder {
    if (!this.proximity.canDelegate(characterId, playerId)) {
      throw new ProximityError(
        `Character ${characterId} cannot receive delegations (closeness too low)`,
      );
    }

    const order = this.chatRepo.createDelegation({
      characterId,
      playerId,
      instruction,
      scope,
      active: true,
      createdAt: Date.now(),
      expiresAt,
    });

    this.log.info({ characterId, playerId, scope }, 'Delegation created');
    return order;
  }

  /**
   * Get active delegations for a character.
   */
  getActive(characterId: string, playerId: string): DelegationOrder[] {
    const orders = this.chatRepo.getActiveDelegations(characterId, playerId);

    // Filter out expired orders
    const now = Date.now();
    const active: DelegationOrder[] = [];

    for (const order of orders) {
      if (order.expiresAt && order.expiresAt < now) {
        this.chatRepo.deactivateDelegation(order.id);
      } else {
        active.push(order);
      }
    }

    return active;
  }

  /**
   * Revoke a specific delegation.
   */
  revoke(delegationId: string): void {
    this.chatRepo.deactivateDelegation(delegationId);
    this.log.info({ delegationId }, 'Delegation revoked');
  }

  /**
   * Revoke all delegations for a character.
   */
  revokeAll(characterId: string, playerId: string): void {
    const active = this.chatRepo.getActiveDelegations(characterId, playerId);
    for (const order of active) {
      this.chatRepo.deactivateDelegation(order.id);
    }
    this.log.info({ characterId, playerId, count: active.length }, 'All delegations revoked');
  }
}
