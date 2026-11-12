import { plain } from './wire';
export type Patch = [string[], any];
export function diff(before: any, after: any, path: string[] = [], out: Patch[] = []): Patch[] {
  if (before === after) return out;
  if ((plain(before) && plain(after)) || (Array.isArray(before) && Array.isArray(after) && after.length >= before.length)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) diff((before as any)[key], (after as any)[key], [...path, key], out);
  } else out.push([path, after ?? null]);
  return out;
}
export function overlaps(a: string[], b: string[]) { return a.slice(0, Math.min(a.length, b.length)).every((p, i) => p === b[i]); }
