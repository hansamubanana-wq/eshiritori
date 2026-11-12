export const GAMES = [
  { id: 'rooms', path: 'eshiritori', key: 'eshiritori', name: '絵しりとり', description: '前の人の絵からしりとりをつなげます。', capacity: 4, minimum: 2 },
  { id: 'rooms-quiz', path: 'drawing-quiz', key: 'quiz', name: 'お絵描きクイズ', description: '描かれた絵のお題を答えて得点を競います。', capacity: 4, minimum: 2 },
  { id: 'rooms-telephone', path: 'drawing-telephone', key: 'telephone', name: '伝言ゲーム', description: '絵と言葉を交互に伝えていきます。', capacity: 4, minimum: 2 },
  { id: 'word-wolf-rooms', path: 'word-wolf', key: 'wordwolf', name: 'ワードウルフ', description: '話し合いと投票で違うお題の人を探します。', capacity: 6, minimum: 3 },
  { id: 'typing-race-rooms', path: 'typing-race', key: 'typing', name: 'タイピングレース', description: '同じ文章を入力して速さを競います。', capacity: 4, minimum: 2 },
  { id: 'quiz-battle-rooms', path: 'quiz-battle', key: 'quizbattle', name: 'クイズバトル', description: '四択クイズの正解と速さを競います。', capacity: 4, minimum: 2 },
  { id: 'memory-card-rooms', path: 'memory-cards', key: 'memory', name: '神経衰弱', description: '同じ絵柄のカードを2枚ずつ探します。', capacity: 4, minimum: 2 },
];
export const TABLES = GAMES.flatMap(game => Array.from({ length: 6 }, (_, i) => ({ game: game.id, code: `table-${i + 1}`, number: i + 1, capacity: game.capacity, minimum: game.minimum })));
export const fixedTable = (game, code) => TABLES.find(t => t.game === game && t.code === code);
