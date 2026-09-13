import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, isNull } from 'drizzle-orm';
import { restaurants } from '@jibli/db';
import { jsonbArrayContains, jsonbArrayContainsColumn } from './jsonb.js';

/**
 * These assert the *generated SQL*, not a hand-written equivalent.
 *
 * This helper exists because two earlier versions of the same query typechecked
 * and failed against Postgres — `= ANY($1)` and `@> ARRAY['x']` — and a third
 * one, `jsonb_build_array($1)` without a cast, reached production and answered
 * every category filter with an empty list. Nothing in TypeScript can tell
 * those apart from a working query: `jsonb` and `text[]` are both `string[]`
 * here.
 *
 * So the check is on the string that reaches the database. The cast is the part
 * that matters and the part that looks removable.
 */

// No connection is opened: `toSQL()` compiles the query without running it.
const db = drizzle({} as never);

describe('jsonbArrayContains()', () => {
  const compile = (value: string) =>
    db
      .select()
      .from(restaurants)
      .where(and(jsonbArrayContains(restaurants.cuisineTags, value), isNull(restaurants.deletedAt)))
      .toSQL();

  it('uses jsonb containment rather than an array operator', () => {
    const { sql } = compile('iraqi');
    expect(sql).toContain('@> jsonb_build_array(');
    // The two forms that compile in TypeScript and fail in Postgres.
    expect(sql).not.toContain('= any(');
    expect(sql).not.toContain('array[');
  });

  it('casts the parameter, without which Postgres cannot type it', () => {
    const { sql } = compile('iraqi');
    expect(sql).toContain('jsonb_build_array($1::text)');
  });

  it('passes the value as a parameter rather than inlining it', () => {
    const { params } = compile("'; drop table restaurants; --");
    expect(params).toEqual(["'; drop table restaurants; --"]);
  });
});

describe('jsonbArrayContainsColumn()', () => {
  it('needs no cast, because a column carries its own type', () => {
    const { sql } = db
      .select()
      .from(restaurants)
      .where(jsonbArrayContainsColumn(restaurants.cuisineTags, restaurants.partnerCode))
      .toSQL();

    expect(sql).toContain('@> jsonb_build_array(');
    expect(sql).not.toContain('::text');
  });
});
