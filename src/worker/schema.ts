import { assert, plain, LIMITS, parts } from './wire';

export const GAME_TYPES = ['rooms', 'rooms-quiz', 'rooms-telephone', 'word-wolf-rooms', 'typing-race-rooms', 'quiz-battle-rooms', 'memory-card-rooms'];
export const GAME_NAMES: Record<string, string> = { eshiritori: 'rooms', quiz: 'rooms-quiz', telephone: 'rooms-telephone', wordwolf: 'word-wolf-rooms', typing: 'typing-race-rooms', quizbattle: 'quiz-battle-rooms', memory: 'memory-card-rooms' };
export const uid = (v: unknown): v is string => typeof v === 'string' && /^u_[a-f0-9]{32}$/.test(v);
export const roomCode = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
type Rule = { kind: string; max?: number; min?: number; values?: any[]; fields?: Record<string, Rule>; item?: Rule; key?: RegExp };
const text = (max = 1000): Rule => ({ kind: 'text', max });
const num = (max = 1e15, min = 0): Rule => ({ kind: 'num', min, max });
const bool: Rule = { kind: 'bool' };
const en = (...values: any[]): Rule => ({ kind: 'enum', values });
const obj = (fields: Record<string, Rule>): Rule => ({ kind: 'obj', fields });
const list = (item: Rule, max = 32): Rule => ({ kind: 'list', item, max });
const map = (item: Rule, key: RegExp, max: number): Rule => ({ kind: 'map', item, key, max });
const id: Rule = { kind: 'id' };
const image: Rule = { kind: 'image' };
const playerKey = /^u_[a-f0-9]{32}$/;
const pushKey = /^k_[a-f0-9]{32}$/;
const commonPlayer = { name: text(40), joinedAt: num(), isHost: bool };
const players = (extra = {}): Rule => map(obj({ ...commonPlayer, ...extra }), playerKey, LIMITS.players);
const order = list(id, LIMITS.players);
const message = obj({ uid: id, sender: text(40), text: text(), timestamp: num(), type: en('chat', 'system', 'correct') });
export const SCHEMAS: Record<string, Rule> = {
  rooms: obj({ status: en('waiting', 'playing', 'result'), currentIndex: num(64), startChar: text(1), endChar: text(1), playersOrder: order,
    players: players(), gameData: list(obj({ player: text(40), image, answer: text(200) }), 64), canvasData: image,
    comments: map(obj({ uid: id, sender: text(40), text: text(), timestamp: num() }), pushKey, 200) }),
  'rooms-quiz': obj({ status: en('waiting', 'playing', 'result'), currentIndex: num(32), currentWord: text(200), timerEnd: num(), drawerId: id,
    playersOrder: order, players: players({ score: num(1000000), guessedCorrectly: bool }), canvasData: image, messages: map(message, pushKey, 200) }),
  'rooms-telephone': obj({ status: en('waiting', 'playing', 'result'), currentStep: num(16), playersOrder: order,
    players: players({ submitted: bool }), showcaseIndex: num(16), stepData: { ...map(map({ kind: 'submission' }, playerKey, 16), /^step_([0-9]|1[0-5])$/, 16), kind: 'steps' } }),
  'word-wolf-rooms': obj({ phase: en('lobby', 'word_reveal', 'discussion', 'voting', 'result'), hostId: id, createdAt: num(),
    players: players({ role: en('', 'wolf', 'citizen'), word: text(100), ready: bool, vote: { kind: 'vote' } }),
    wordPair: obj({ common: text(100), wolf: text(100) }), discussionEndTime: num(),
    chat: map(obj({ uid: id, name: text(40), text: text(), ts: num() }), pushKey, 200) }),
  'typing-race-rooms': obj({ phase: en('lobby', 'racing', 'result'), hostId: id, createdAt: num(), players: players({ progress: num(1), finishTime: num(3600) }), raceText: text(2000), startTime: num() }),
  'quiz-battle-rooms': obj({ phase: en('lobby', 'question', 'result'), hostId: id, createdAt: num(), players: players({ score: num(1000000) }),
    questions: list(obj({ q: text(500), opts: list(text(200), 4), a: num(3) }), 10), currentQuestion: num(10), questionStartTime: num(), answers: map(num(3), playerKey, 16) }),
  'memory-card-rooms': obj({ phase: en('lobby', 'playing', 'result'), hostId: id, createdAt: num(), players: players({ score: num(30) }),
    cards: list(obj({ id: num(29), emoji: text(16), faceUp: bool, matchedBy: { kind: 'vote' } }), 30), turnOrder: order, currentTurnIdx: num(15), flipped: list(num(29), 2) }),
};
export function validate(rule: Rule | undefined, value: any, depth = 0): void {
  assert(rule && depth < 12, 'invalid_path');
  if (value === null) return;
  switch (rule.kind) {
    case 'text': assert(typeof value === 'string' && value.length <= rule.max! && !/[<>\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value), 'invalid_string'); break;
    case 'num': assert(typeof value === 'number' && Number.isFinite(value) && value >= rule.min! && value <= rule.max!, 'invalid_number'); break;
    case 'bool': assert(typeof value === 'boolean', 'invalid_boolean'); break;
    case 'enum': assert(rule.values!.includes(value), 'invalid_enum'); break;
    case 'id': assert(uid(value), 'invalid_player'); break;
    case 'vote': assert(value === '' || uid(value), 'invalid_player'); break;
    case 'image': assert(typeof value === 'string' && value.length <= LIMITS.image && (value === '' || /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(value)), 'invalid_image'); break;
    case 'submission': validate(typeof value === 'string' && value.startsWith('data:') ? image : text(200), value, depth + 1); break;
    case 'list': assert(Array.isArray(value) && value.length <= rule.max! && Object.keys(value).length === value.length, 'invalid_list'); value.forEach(v => { assert(v !== null, 'invalid_list'); validate(rule.item, v, depth + 1); }); break;
    case 'obj':
      assert(plain(value), 'invalid_object');
      for (const [k, v] of Object.entries(value)) { assert(Object.hasOwn(rule.fields!, k), 'invalid_path'); validate(rule.fields![k], v, depth + 1); }
      break;
    case 'steps': if (value === '') break;
    case 'map':
      assert(plain(value) && Object.keys(value).length <= rule.max!, 'invalid_map');
      for (const [k, v] of Object.entries(value)) { assert(rule.key!.test(k), 'invalid_path'); validate(rule.item, v, depth + 1); }
      break;
    default: throw new Error('invalid_path');
  }
}
export function ruleAt(game: string, path: string[]): Rule | undefined {
  let rule: Rule | undefined = SCHEMAS[game];
  for (const key of path) {
    if (!rule) return;
    if (rule.kind === 'obj') rule = Object.hasOwn(rule.fields!, key) ? rule.fields![key] : undefined;
    else if (['map', 'steps'].includes(rule.kind) && rule.key!.test(key)) rule = rule.item;
    else if (rule.kind === 'list' && /^(0|[1-9][0-9]?)$/.test(key) && +key < rule.max!) rule = rule.item;
    else return;
  }
  return rule;
}
// Root update is supported only as an atomic batch in ONE exact room; root reads are never supported.
export function mutations(game: string, code: string, m: any): [string[], any][] {
  assert(['set', 'update', 'remove'].includes(m.op), 'invalid_operation');
  const base = m.path === '' ? [] : parts(m.path);
  const raw = m.op === 'update' ? (assert(plain(m.value) && Object.keys(m.value).length > 0 && Object.keys(m.value).length <= 128, 'invalid_update'), Object.entries(m.value).map(([p, v]) => [[...base, ...parts(p)], v] as [string[], any])) : [[base, m.op === 'remove' ? null : m.value] as [string[], any]];
  return raw.map(([p, v]) => {
    assert(p[0] === game && p[1] === code && p.length >= 2, 'forbidden_path');
    const sub = p.slice(2); validate(ruleAt(game, sub), v);
    return [sub, v];
  });
}
