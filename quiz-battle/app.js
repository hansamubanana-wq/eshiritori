import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyA1JE1-7hPGNeFCQn3egNwmgmViy79UYHE",
    authDomain: "eshiritori-64c6c.firebaseapp.com",
    databaseURL: "https://eshiritori-64c6c-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "eshiritori-64c6c",
    storageBucket: "eshiritori-64c6c.firebasestorage.app",
    messagingSenderId: "549200845335",
    appId: "1:549200845335:web:2d9dc77d1a83c9548c5a52"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const ALL_QUESTIONS = [
    { q: "日本の首都はどこ？", opts: ["大阪", "東京", "名古屋", "京都"], a: 1 },
    { q: "1+1は？", opts: ["1", "2", "3", "4"], a: 1 },
    { q: "世界で一番大きい大陸は？", opts: ["アフリカ", "北アメリカ", "アジア", "南アメリカ"], a: 2 },
    { q: "人間の体で一番大きい臓器は？", opts: ["心臓", "肝臓", "肺", "皮膚"], a: 3 },
    { q: "ドラえもんの好物は？", opts: ["アンパン", "おにぎり", "どら焼き", "たい焼き"], a: 2 },
    { q: "太陽系で一番大きい惑星は？", opts: ["土星", "木星", "天王星", "海王星"], a: 1 },
    { q: "富士山の高さは？", opts: ["3,576m", "3,776m", "3,876m", "3,976m"], a: 1 },
    { q: "ピカチュウのタイプは？", opts: ["ほのお", "みず", "でんき", "くさ"], a: 2 },
    { q: "1年は何週間？", opts: ["48週間", "50週間", "52週間", "54週間"], a: 2 },
    { q: "チーズの原料は？", opts: ["豆乳", "卵", "小麦粉", "牛乳"], a: 3 },
    { q: "世界で最も多く話される言語は？", opts: ["英語", "スペイン語", "中国語", "ヒンディー語"], a: 2 },
    { q: "虹は何色？", opts: ["5色", "6色", "7色", "8色"], a: 2 },
    { q: "水の化学式は？", opts: ["CO2", "H2O", "NaCl", "O2"], a: 1 },
    { q: "オリンピックのシンボルは何個の輪？", opts: ["3個", "4個", "5個", "6個"], a: 2 },
    { q: "日本で一番高い山は？", opts: ["北岳", "奥穂高岳", "槍ヶ岳", "富士山"], a: 3 },
    { q: "アメリカの独立記念日は？", opts: ["6月4日", "7月4日", "8月4日", "9月4日"], a: 1 },
    { q: "ハチミツを作るのは？", opts: ["アリ", "チョウ", "ミツバチ", "アブ"], a: 2 },
    { q: "光の速さは秒速約何km？", opts: ["3万km", "30万km", "300万km", "3000万km"], a: 1 },
    { q: "サッカーのゴールキーパー以外は何人？", opts: ["9人", "10人", "11人", "12人"], a: 1 },
    { q: "桃太郎が戦った鬼のすみかは？", opts: ["金の島", "鬼ヶ島", "幽霊島", "竜宮城"], a: 1 },
    { q: "東京タワーの高さは？", opts: ["233m", "333m", "433m", "533m"], a: 1 },
    { q: "地球から月までの距離は約？", opts: ["38万km", "3.8万km", "380万km", "3800km"], a: 0 },
    { q: "日本の国旗の色は？", opts: ["白と青", "白と赤", "赤と金", "青と赤"], a: 1 },
    { q: "折り紙は何語？", opts: ["origami", "otsukami", "okami", "oseki"], a: 0 },
    { q: "1オクターブは何音？", opts: ["6音", "7音", "8音", "9音"], a: 2 },
    { q: "人間の骨は大人で約何本？", opts: ["106本", "206本", "306本", "406本"], a: 1 },
    { q: "ピザの発祥国は？", opts: ["フランス", "スペイン", "イタリア", "ギリシャ"], a: 2 },
    { q: "地球の表面の何割が海？", opts: ["約5割", "約6割", "約7割", "約8割"], a: 2 },
    { q: "シェイクスピアの代表作は？", opts: ["罪と罰", "変身", "ハムレット", "神曲"], a: 2 },
    { q: "日本の都道府県は何個？", opts: ["43", "45", "47", "49"], a: 2 },
];

const QUESTION_COUNT = 10;
const QUESTION_TIME = 12;
const RPATH = (id) => `quiz-battle-rooms/${id}`;

let roomId = "";
let myPlayerId = "";
let myPlayerName = "";
let isHost = false;
let roomState = null;
let currentPhase = "";
let timerInterval = null;
let myAnsweredQuestion = -1;
let isTransitioning = false;

document.addEventListener("DOMContentLoaded", () => {
    const saved = localStorage.getItem('username');
    if (saved) document.getElementById('user-name').value = saved;
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) document.getElementById('room-id').value = roomParam;
});

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(`screen-${id}`);
    if (el) el.classList.add('active');
}

window.connectLobby = async function() {
    const name = document.getElementById('user-name').value.trim();
    const room = document.getElementById('room-id').value.trim();
    if (!name || !room) { alert("名前と部屋IDを入力してください"); return; }

    myPlayerName = name;
    roomId = room;
    myPlayerId = "p_" + Math.random().toString(36).substring(2, 10);
    localStorage.setItem('username', name);

    const snap = await get(ref(db, RPATH(roomId)));
    let createNew = !snap.exists();
    if (snap.exists()) {
        const d = snap.val();
        if (d.phase !== "lobby" && d.phase !== "result") {
            alert("このゲームはすでに進行中です。別の部屋IDをお試しください。");
            return;
        }
        if (d.phase === "result") createNew = true;
    }

    if (createNew) {
        isHost = true;
        await set(ref(db, RPATH(roomId)), { phase: "lobby", hostId: myPlayerId, createdAt: Date.now() });
    }

    await set(ref(db, `${RPATH(roomId)}/players/${myPlayerId}`), {
        name: myPlayerName, score: 0, joinedAt: Date.now()
    });
    if (createNew) await update(ref(db, RPATH(roomId)), { hostId: myPlayerId });

    listenToRoom();
    showScreen("lobby");
    document.getElementById('lobby-room-title').textContent = `部屋: ${roomId}`;
};

function listenToRoom() {
    onValue(ref(db, RPATH(roomId)), (snap) => {
        if (!snap.exists()) return;
        roomState = snap.val();
        isHost = roomState.hostId === myPlayerId;
        const phase = roomState.phase;
        if (phase === "lobby") onLobbyUpdate();
        else if (phase === "question") onQuestionUpdate();
        else if (phase === "result") onResultUpdate();
    });
}

// ===== LOBBY =====
function onLobbyUpdate() {
    if (currentPhase !== "lobby") {
        currentPhase = "lobby";
        isTransitioning = false;
        myAnsweredQuestion = -1;
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
        showScreen("lobby");
    }
    const players = roomState.players || {};
    document.getElementById('lobby-players-list').innerHTML = Object.entries(players).map(([id, p]) =>
        `<div style="padding:5px 0;">${id === myPlayerId ? "🟢" : "⚪"} ${p.name}${id === roomState.hostId ? " 👑" : ""}</div>`
    ).join('');

    if (isHost) {
        document.getElementById('start-game-btn').style.display = Object.keys(players).length >= 2 ? 'inline-block' : 'none';
        document.getElementById('wait-host-msg').textContent = Object.keys(players).length >= 2 ? "クイズをスタートできます！" : "あと1人以上必要です。";
    } else {
        document.getElementById('start-game-btn').style.display = 'none';
        document.getElementById('wait-host-msg').textContent = "ホストがスタートを押すと始まります。";
    }
}

window.hostStartGame = async function() {
    if (!isHost || isTransitioning) return;
    isTransitioning = true;

    // Shuffle and pick questions
    const shuffled = [...ALL_QUESTIONS].sort(() => Math.random() - 0.5).slice(0, QUESTION_COUNT);
    const players = roomState.players || {};
    const updates = {};
    Object.keys(players).forEach(pid => {
        updates[`${RPATH(roomId)}/players/${pid}/score`] = 0;
    });
    updates[`${RPATH(roomId)}/questions`] = shuffled;
    updates[`${RPATH(roomId)}/currentQuestion`] = 0;
    updates[`${RPATH(roomId)}/questionStartTime`] = Date.now() + 1000;
    updates[`${RPATH(roomId)}/answers`] = null;
    updates[`${RPATH(roomId)}/phase`] = "question";
    await update(ref(db), updates);
    isTransitioning = false;
};

// ===== QUESTION =====
let lastQuestionIdx = -1;

function onQuestionUpdate() {
    if (currentPhase !== "question") {
        currentPhase = "question";
        showScreen("question");
    }

    const qIdx = roomState.currentQuestion || 0;
    const questions = roomState.questions || [];
    const total = questions.length;

    if (qIdx !== lastQuestionIdx) {
        lastQuestionIdx = qIdx;
        myAnsweredQuestion = -1;
        showQuestion(qIdx, questions, total);
    }

    renderScoreList();
}

function showQuestion(qIdx, questions, total) {
    const q = questions[qIdx];
    document.getElementById('q-num').textContent = qIdx + 1;
    document.getElementById('q-total').textContent = total;
    document.getElementById('question-text').textContent = q.q;
    document.getElementById('answer-reveal-area').style.display = 'none';
    document.getElementById('next-question-btn').style.display = 'none';

    const colors = ['#e74c3c', '#3498db', '#27ae60', '#f39c12'];
    const labels = ['A', 'B', 'C', 'D'];
    document.getElementById('choices-grid').innerHTML = q.opts.map((opt, i) =>
        `<button class="choice-btn" id="choice-${i}" onclick="submitAnswer(${i})"
            style="border-color:${colors[i]};border-bottom-color:${colors[i]}cc;">
            <span style="font-size:12px;opacity:0.6;">${labels[i]}.</span> ${opt}
        </button>`
    ).join('');

    startQuestionTimer(roomState.questionStartTime, total, qIdx);
}

function startQuestionTimer(startTime, total, qIdx) {
    if (timerInterval) clearInterval(timerInterval);
    const circle = document.getElementById('timer-circle');

    timerInterval = setInterval(() => {
        if (!roomState || roomState.phase !== "question" || roomState.currentQuestion !== qIdx) {
            clearInterval(timerInterval);
            return;
        }
        const elapsed = (Date.now() - startTime) / 1000;
        const remaining = Math.max(0, QUESTION_TIME - elapsed);
        const pct = (remaining / QUESTION_TIME) * 100;

        if (circle) {
            circle.textContent = Math.ceil(remaining);
            circle.className = remaining < 4 ? 'timer-circle urgent' : 'timer-circle';
            circle.style.background = `conic-gradient(${remaining < 4 ? '#e74c3c' : '#e67e22'} ${pct}%, #f4eee1 ${pct}%)`;
        }

        if (remaining <= 0) {
            clearInterval(timerInterval);
            revealAnswer(qIdx);
            if (isHost) {
                setTimeout(() => {
                    document.getElementById('next-question-btn').style.display = 'block';
                }, 500);
            }
        }
    }, 200);
}

function revealAnswer(qIdx) {
    const questions = roomState.questions || [];
    const q = questions[qIdx];
    if (!q) return;

    const btns = document.querySelectorAll('.choice-btn');
    btns.forEach((btn, i) => {
        btn.disabled = true;
        if (i === q.a) btn.classList.add('reveal-correct');
        else if (btn.classList.contains('selected')) btn.classList.add('wrong');
    });

    const answers = roomState.answers || {};
    const myAnswer = answers[myPlayerId];
    const area = document.getElementById('answer-reveal-area');
    area.style.display = 'block';
    if (myAnswer !== undefined) {
        if (myAnswer === q.a) {
            area.innerHTML = `<div class="answer-correct-label">✅ 正解！</div><div>正解は「${q.opts[q.a]}」でした！</div>`;
        } else {
            area.innerHTML = `<div class="answer-wrong-label">❌ 不正解</div><div>正解は「${q.opts[q.a]}」でした。</div>`;
        }
    } else {
        area.innerHTML = `<div class="answer-wrong-label">⏰ 時間切れ</div><div>正解は「${q.opts[q.a]}」でした。</div>`;
    }
}

window.submitAnswer = async function(choiceIdx) {
    if (myAnsweredQuestion === lastQuestionIdx) return;
    const qIdx = roomState.currentQuestion || 0;
    const elapsed = (Date.now() - roomState.questionStartTime) / 1000;
    if (elapsed >= QUESTION_TIME) return;

    myAnsweredQuestion = qIdx;

    // Highlight selected
    document.querySelectorAll('.choice-btn').forEach((btn, i) => {
        btn.disabled = true;
        if (i === choiceIdx) btn.classList.add('selected');
    });

    // Calculate score: 100 at 0s, 10 at 12s
    const q = (roomState.questions || [])[qIdx];
    const isCorrect = choiceIdx === q?.a;
    const pointsEarned = isCorrect ? Math.max(10, Math.round(100 - (elapsed / QUESTION_TIME) * 90)) : 0;

    const updates = {};
    updates[`${RPATH(roomId)}/answers/${myPlayerId}`] = choiceIdx;
    if (isCorrect) {
        const currentScore = (roomState.players?.[myPlayerId]?.score) || 0;
        updates[`${RPATH(roomId)}/players/${myPlayerId}/score`] = currentScore + pointsEarned;
    }
    await update(ref(db), updates);

    // Check if all answered
    const players = roomState.players || {};
    const answers = { ...(roomState.answers || {}), [myPlayerId]: choiceIdx };
    if (Object.keys(answers).length >= Object.keys(players).length) {
        revealAnswer(qIdx);
        if (isHost) {
            setTimeout(() => {
                const btn = document.getElementById('next-question-btn');
                if (btn) btn.style.display = 'block';
            }, 500);
        }
    }
};

window.hostNextQuestion = async function() {
    if (!isHost || isTransitioning) return;
    isTransitioning = true;
    const qIdx = (roomState.currentQuestion || 0) + 1;
    const total = (roomState.questions || []).length;

    if (qIdx >= total) {
        await update(ref(db, RPATH(roomId)), { phase: "result" });
    } else {
        await update(ref(db, RPATH(roomId)), {
            currentQuestion: qIdx,
            questionStartTime: Date.now() + 500,
            answers: null
        });
    }
    isTransitioning = false;
};

function renderScoreList() {
    const players = roomState.players || {};
    const sorted = Object.entries(players).sort(([, a], [, b]) => b.score - a.score);
    document.getElementById('score-list').innerHTML = sorted.map(([id, p]) =>
        `<div class="score-row${id === myPlayerId ? ' just-scored' : ''}">
            <span>${p.name}${id === myPlayerId ? ' 👈' : ''}</span>
            <span class="score-value">${p.score}</span>
        </div>`
    ).join('');
}

// ===== RESULT =====
function onResultUpdate() {
    if (currentPhase !== "result") {
        currentPhase = "result";
        if (timerInterval) clearInterval(timerInterval);
        showScreen("result");
    }
    const players = roomState.players || {};
    const sorted = Object.entries(players).sort(([, a], [, b]) => b.score - a.score);
    const rankBadges = ['rank-1', 'rank-2', 'rank-3'];
    document.getElementById('result-leaderboard').innerHTML = sorted.map(([id, p], idx) =>
        `<div class="leaderboard-row">
            <div class="rank-badge ${rankBadges[idx] || ''}">${idx + 1}</div>
            <div class="leaderboard-name">${p.name}${id === myPlayerId ? ' 👈' : ''}</div>
            <div class="leaderboard-score">${p.score}点</div>
        </div>`
    ).join('');
    if (isHost) document.getElementById('restart-btn').style.display = 'inline-block';
}

window.restartGame = async function() {
    if (!isHost) return;
    isTransitioning = false;
    lastQuestionIdx = -1;
    myAnsweredQuestion = -1;
    const players = roomState.players || {};
    const updates = {};
    Object.keys(players).forEach(pid => { updates[`${RPATH(roomId)}/players/${pid}/score`] = 0; });
    updates[`${RPATH(roomId)}/phase`] = "lobby";
    updates[`${RPATH(roomId)}/questions`] = null;
    updates[`${RPATH(roomId)}/answers`] = null;
    await update(ref(db), updates);
};
