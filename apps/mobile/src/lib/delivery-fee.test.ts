import { describe, expect, it } from 'vitest';
import { customerDeliveryFee } from './delivery-fee';

describe('customerDeliveryFee()', () => {
  it('folds the service fee into the delivery fee', () => {
    expect(customerDeliveryFee(1500, 500)).toBe(2000);
  });

  it('is free only when both are zero', () => {
    expect(customerDeliveryFee(0, 0)).toBe(0);
    expect(customerDeliveryFee(0, 500)).toBe(500);
  });

  it('never goes negative on a bad value', () => {
    expect(customerDeliveryFee(-100, 500)).toBe(500);
  });
});
