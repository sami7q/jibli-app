import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A static guard over raw `sql` fragments.
 *
 * Five endpoints returned 500 in production — the admin dashboard, order
 * stats, the driver list, coupon filters and the restaurant order board — all
 * for the same reason: a JavaScript value interpolated into a raw `sql`
 * template reaches the driver with no type attached.
 *
 *   sql`... >= ${monthAgo}`          → Bind receives a Date, throws
 *   sql`... = ANY(${statuses})`      → Postgres rejects the right-hand side
 *
 * Drizzle's operators do not have this problem: `gte(orders.completedAt, from)`
 * takes the type from the column. The rule is therefore "compare through an
 * operator, not through string interpolation".
 *
 * This is a source scan rather than a functional test because the suite has no
 * database — which is precisely why these shipped. It cannot prove a query
 * runs; it only refuses the two shapes that are known to fail. Anything it
 * flags has a direct replacement: `inArray` / `notInArray` for the first,
 * `gte` / `lt` / `lte` / `gt` for the second.
 */

const ROOTS = ['apps/api/src', 'apps/worker/src', 'packages/domain/src'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function scan(pattern: RegExp): Finding[] {
  const findings: Finding[] = [];
  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((text, index) => {
        if (pattern.test(text)) {
          findings.push({ file, line: index + 1, text: text.trim() });
        }
      });
    }
  }
  return findings;
}

const format = (findings: Finding[]): string =>
  findings.map((f) => `${f.file}:${f.line}\n    ${f.text}`).join('\n');

describe('raw SQL fragments', () => {
  it('never puts an interpolated array behind ANY() or ALL()', () => {
    /*
     * `${statuses}` arrives as a bare parameter, and Postgres answers
     * "op ANY/ALL (array) requires array on right side". `inArray(column,
     * statuses)` builds the IN list with the column's own type.
     */
    const findings = scan(/(?:ANY|ALL)\s*\(\s*\$\{/);
    expect(format(findings)).toBe('');
  });

  it('never compares a column against a bare interpolated value', () => {
    /*
     * Flags `>= ${value}` inside a template while allowing `>= ${table.column}`
     * and `>= ${someOperator(...)}`, which carry their own type. The heuristic
     * is deliberately narrow: it is a tripwire for the shape that failed, not
     * a parser.
     */
    const findings = scan(/(?:>=|<=|>|<)\s*\$\{\s*[a-zA-Z_$][\w$]*\s*\}/);
    expect(format(findings)).toBe('');
  });
});
