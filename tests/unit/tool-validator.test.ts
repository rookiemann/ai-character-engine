import { describe, it, expect, beforeEach } from 'vitest';
import { ToolValidator } from '../../src/tools/ToolValidator';
import { ToolError } from '../../src/core/errors';
import type { ToolDefinition, ToolCall } from '../../src/core/types';

describe('ToolValidator', () => {
  let validator: ToolValidator;

  const tools: ToolDefinition[] = [
    {
      name: 'attack',
      description: 'Attack target',
      parameters: [
        { name: 'target', type: 'string', description: 'Target name', required: true },
        { name: 'power', type: 'number', description: 'Power level', required: false, min: 1, max: 10 },
      ],
      requiredTier: 'active',
      minCloseness: 30,
    },
    {
      name: 'rest',
      description: 'Take a rest',
      parameters: [
        { name: 'duration', type: 'number', description: 'Seconds', default: 5 },
      ],
    },
    {
      name: 'toggle',
      description: 'Toggle option',
      parameters: [
        { name: 'enabled', type: 'boolean', description: 'On/off', required: true },
      ],
    },
    {
      name: 'gather',
      description: 'Gather items',
      parameters: [
        { name: 'items', type: 'array', description: 'Items to gather', maxItems: 3 },
      ],
    },
    {
      name: 'move',
      description: 'Move to location',
      parameters: [
        { name: 'direction', type: 'string', description: 'Direction', enum: ['north', 'south', 'east', 'west'] },
        { name: 'message', type: 'string', description: 'Note', required: false, maxLength: 10 },
      ],
    },
    {
      name: 'cast',
      description: 'Cast spell',
      parameters: [
        { name: 'power', type: 'number', description: 'Spell power', required: true },
      ],
    },
  ];

  beforeEach(() => {
    validator = new ToolValidator();
  });

  // --- Tool lookup ---

  it('should find and return the matching tool definition', () => {
    const call: ToolCall = { toolName: 'attack', arguments: { target: 'goblin' } };
    const result = validator.validate(call, tools, 'active', 50);
    expect(result.name).toBe('attack');
  });

  it('should throw ToolError for unknown tool', () => {
    const call: ToolCall = { toolName: 'fly', arguments: {} };
    expect(() => validator.validate(call, tools, 'active', 50)).toThrow(ToolError);
    expect(() => validator.validate(call, tools, 'active', 50)).toThrow('Unknown tool: fly');
  });

  // --- Tier/closeness ---

  it('should throw when tier requirement not met', () => {
    const call: ToolCall = { toolName: 'attack', arguments: { target: 'goblin' } };
    expect(() => validator.validate(call, tools, 'dormant', 50)).toThrow(ToolError);
  });

  it('should throw when closeness requirement not met', () => {
    const call: ToolCall = { toolName: 'attack', arguments: { target: 'goblin' } };
    expect(() => validator.validate(call, tools, 'active', 10)).toThrow('closeness');
  });

  // --- String coercion ---

  it('should coerce number to string', () => {
    const call: ToolCall = { toolName: 'attack', arguments: { target: 42 } };
    validator.validate(call, tools, 'active', 50);
    expect(call.arguments.target).toBe('42');
  });

  it('should truncate string exceeding maxLength', () => {
    const call: ToolCall = { toolName: 'move', arguments: { direction: 'north', message: 'very long message' } };
    validator.validate(call, tools, 'active', 50);
    expect((call.arguments.message as string).length).toBe(10);
  });

  it('should accept valid enum value', () => {
    const call: ToolCall = { toolName: 'move', arguments: { direction: 'north' } };
    validator.validate(call, tools, 'active', 50);
    expect(call.arguments.direction).toBe('north');
  });

  it('should throw for invalid enum value', () => {
    const call: ToolCall = { toolName: 'move', arguments: { direction: 'up' } };
    expect(() => validator.validate(call, tools, 'active', 50)).toThrow('must be one of');
  });

  // --- Number coercion ---

  it('should coerce string to number', () => {
    const call: ToolCall = { toolName: 'attack', arguments: { target: 'goblin', power: '7' } };
    validator.validate(call, tools, 'active', 50);
    expect(call.arguments.power).toBe(7);
  });

  it('should clamp number to min/max range', () => {
    const call: ToolCall = { toolName: 'attack', arguments: { target: 'goblin', power: 50 } };
    validator.validate(call, tools, 'active', 50);
    expect(call.arguments.power).toBe(10);
  });

  it('should throw for non-numeric string as number', () => {
    const call: ToolCall = { toolName: 'attack', arguments: { target: 'goblin', power: 'abc' } };
    expect(() => validator.validate(call, tools, 'active', 50)).toThrow('non-numeric');
  });

  it('should throw for Infinity', () => {
    const call: ToolCall = { toolName: 'cast', arguments: { power: Infinity } };
    expect(() => validator.validate(call, tools, 'active', 50)).toThrow('finite');
  });

  // --- Boolean coercion ---

  it('should coerce truthy strings to true', () => {
    for (const val of ['true', 'yes', '1']) {
      const call: ToolCall = { toolName: 'toggle', arguments: { enabled: val } };
      validator.validate(call, tools, 'active', 50);
      expect(call.arguments.enabled).toBe(true);
    }
  });

  it('should coerce falsy strings to false', () => {
    for (const val of ['false', 'no', '0']) {
      const call: ToolCall = { toolName: 'toggle', arguments: { enabled: val } };
      validator.validate(call, tools, 'active', 50);
      expect(call.arguments.enabled).toBe(false);
    }
  });

  // --- Array coercion ---

  it('should coerce comma-separated string to array', () => {
    const call: ToolCall = { toolName: 'gather', arguments: { items: 'a, b, c' } };
    validator.validate(call, tools, 'active', 50);
    expect(call.arguments.items).toEqual(['a', 'b', 'c']);
  });

  it('should truncate array exceeding maxItems', () => {
    const call: ToolCall = { toolName: 'gather', arguments: { items: ['a', 'b', 'c', 'd', 'e'] } };
    validator.validate(call, tools, 'active', 50);
    expect((call.arguments.items as unknown[]).length).toBe(3);
  });

  // --- Required param with default ---

  it('should apply default value for missing required param', () => {
    const call: ToolCall = { toolName: 'rest', arguments: {} };
    validator.validate(call, tools, 'active', 50);
    expect(call.arguments.duration).toBe(5);
  });
});
