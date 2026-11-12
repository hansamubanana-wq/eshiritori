export interface Game { id: string; path: string; key: string; name: string; description: string; capacity: number; minimum: number }
export interface FixedTable { game: string; code: string; number: number; capacity: number; minimum: number }
export const GAMES: Game[];
export const TABLES: FixedTable[];
export function fixedTable(game: unknown, code: unknown): FixedTable | undefined;
