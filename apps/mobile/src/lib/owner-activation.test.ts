import { describe, expect, it } from 'vitest';
import { activationState, activationSteps } from './owner-activation';

/**
 * The checklist as the owner reads it: what is missing comes first, what is
 * theirs to do says where, and the card's state follows the shop's.
 */

const check = (key: string, passed: boolean, blocking = true) => ({
  key,
  label_ar: key,
  passed,
  blocking,
});

const base = {
  ready: false,
  operational_status: 'PENDING',
  activation_requested_at: null,
  blocking_failures: [],
};

describe('activationSteps', () => {
  it('puts failing blocking checks first, then failing optional ones, then the done ones', () => {
    const steps = activationSteps({
      checks: [
        check('commissionConfigured', true),
        check('hasActiveDriver', false, false),
        check('hasActiveMenuItem', false),
        check('branchLocationValid', false),
      ],
    });
    expect(steps.map((step) => step.key)).toEqual([
      'hasActiveMenuItem',
      'branchLocationValid',
      'hasActiveDriver',
      'commissionConfigured',
    ]);
  });

  it('sends the owner to the right door for each step', () => {
    const steps = activationSteps({
      checks: [
        check('hasActiveMenuItem', false),
        check('branchLocationValid', false),
        check('commissionConfigured', false),
      ],
    });
    expect(steps.map((step) => step.action)).toEqual(['product', 'pin', 'admin']);
  });

  it('leaves out the checks it is told to', () => {
    const steps = activationSteps(
      { checks: [check('hasActiveDriver', false, false), check('hasActiveMenuItem', false)] },
      { omit: ['hasActiveDriver'] },
    );
    expect(steps.map((step) => step.key)).toEqual(['hasActiveMenuItem']);
  });

  it('opens the hours screen for the hours check', () => {
    const [step] = activationSteps({ checks: [check('workingHoursConfigured', false)] });
    expect(step?.action).toBe('hours');
  });

  it('has words for a check it has never heard of', () => {
    const [step] = activationSteps({ checks: [check('somethingNew', false)] });
    expect(step?.action).toBe('admin');
    expect(step?.hint.length).toBeGreaterThan(0);
  });
});

describe('activationState', () => {
  it('is live for an active shop whatever the checks say', () => {
    expect(
      activationState({ ...base, operational_status: 'ACTIVE', checks: [check('x', false)] }),
    ).toEqual({ kind: 'live' });
  });

  it('is suspended for a suspended shop', () => {
    expect(activationState({ ...base, operational_status: 'SUSPENDED', checks: [] })).toEqual({
      kind: 'suspended',
    });
  });

  it('is requested once Jibli has been asked', () => {
    expect(
      activationState({
        ...base,
        ready: true,
        activation_requested_at: '2026-09-30T10:00:00.000Z',
        checks: [],
      }),
    ).toEqual({ kind: 'requested', since: '2026-09-30T10:00:00.000Z' });
  });

  it('is ready when every blocking check passes and nobody has asked', () => {
    expect(activationState({ ...base, ready: true, checks: [check('x', true)] })).toEqual({
      kind: 'ready',
    });
  });

  it('counts what is left, and how much of it is the owner’s', () => {
    const state = activationState({
      ...base,
      checks: [
        check('hasActiveMenuItem', false),
        check('branchLocationValid', false),
        check('commissionConfigured', false),
        check('hasActiveDriver', false, false),
      ],
    });
    expect(state).toEqual({ kind: 'todo', remaining: 3, mine: 2 });
  });
});
