/**
 * A number and the noun it counts, the way Arabic says it.
 *
 * Arabic does not pluralise the way English does. One and two have words of
 * their own, three to ten take the plural, and eleven upwards goes back to
 * the singular: «دقيقتين», «5 دقائق», «13 دقيقة». «13 دقائق» reads to an Arabic
 * speaker the way «13 minute» does in English — and a shop owner or a courier
 * reads these lines all day.
 *
 * The same rule as `pluralAr` in `@jibli/ui-web`, which the portals use; that
 * package is built for the web, so the app keeps its own copy of the rule.
 */
export interface CountedNoun {
  /** One of them: «دقيقة», «قطعة واحدة». */
  readonly one: string;
  /** Two of them, as the dual: «دقيقتين», «قطعتان». */
  readonly two: string;
  /** After three to ten: «دقائق», «قطع». */
  readonly few: string;
  /** After eleven and up — the singular again: «دقيقة», «قطعة». */
  readonly many: string;
}

export function countAr(count: number, noun: CountedNoun): string {
  if (count === 1) return noun.one;
  if (count === 2) return noun.two;
  const lastTwo = count % 100;
  if (lastTwo >= 3 && lastTwo <= 10) return `${count} ${noun.few}`;
  return `${count} ${noun.many}`;
}

/** After «منذ» or «خلال», hence the genitive dual. */
export const MINUTES: CountedNoun = { one: 'دقيقة', two: 'دقيقتين', few: 'دقائق', many: 'دقيقة' };

export const PIECES: CountedNoun = { one: 'قطعة واحدة', two: 'قطعتان', few: 'قطع', many: 'قطعة' };

/** As the subject of a line: «طلبان جديدان بانتظار قبولك». */
export const NEW_ORDERS: CountedNoun = {
  one: 'طلب جديد',
  two: 'طلبان جديدان',
  few: 'طلبات جديدة',
  many: 'طلباً جديداً',
};
