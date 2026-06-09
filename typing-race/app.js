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

const raceTexts = [
    "あかいくつはいたおんなのこあのこどこいったにほんにきたよ",
    "はなよりだんごといいますがやはりきれいなはなをみるとこころがやすらぎます",
    "ねこはひなたぼっこがすきないぬはおさんぽがだいすき",
    "たのしいゲームをみんなでやろうともだちとおもいでをつくろう",
    "はるはあけぼのやうやうしろくなりゆくやまぎわすこしあかくなりて",
    "あさひをあびてやまはかがやきかわはながれそらにはとりがとんでいる",
    "すきなたべものはなんですかわたしはすしとラーメンがだいすきです",
    "まいにちすこしずつがんばればかならずゴールにたどりつけます",
    "おもしろいゲームをつくるためにたくさんのアイデアがひつようです",
    "きょうはいいてんきなのでこうえんでピクニックをしましょう",
];

const RPATH = (id) => `typing-race-rooms/${id}`;

let roomId = "";
let myPlayerId = "";
let myPlayerName = "";
let isHost = false;
let roomState = null;
let currentPhase = "";
let raceTimerInterval = null;
let progressUpdateTimeout = null;
let raceStartTime = 0;
let myFinished = false;
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
        const data = snap.val();
        if (data.phase !== "lobby" && data.phase !== "result") {
            alert("このゲームはすでに進行中です。別の部屋IDをお試しください。");
            return;
        }
        if (data.phase === "result") createNew = true;
    }

    if (createNew) {
        isHost = true;
        await set(ref(db, RPATH(roomId)), {
            phase: "lobby", hostId: myPlayerId, createdAt: Date.now()
        });
    }

    await set(ref(db, `${RPATH(roomId)}/players/${myPlayerId}`), {
        name: myPlayerName, progress: 0, finishTime: 0, joinedAt: Date.now()
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
        else if (phase === "racing") onRacingUpdate();
        else if (phase === "result") onResultUpdate();
    });
}

// ===== LOBBY =====
function onLobbyUpdate() {
    if (currentPhase !== "lobby") {
        currentPhase = "lobby";
        isTransitioning = false;
        myFinished = false;
        if (raceTimerInterval) { clearInterval(raceTimerInterval); raceTimerInterval = null; }
        showScreen("lobby");
    }
    const players = roomState.players || {};
    document.getElementById('lobby-players-list').innerHTML = Object.entries(players).map(([id, p]) =>
        `<div style="padding:5px 0;">${id === myPlayerId ? "🟢" : "⚪"} ${p.name}${id === roomState.hostId ? " 👑" : ""}</div>`
    ).join('');

    if (isHost) {
        document.getElementById('start-game-btn').style.display = Object.keys(players).length >= 2 ? 'inline-block' : 'none';
        document.getElementById('wait-host-msg').textContent = Object.keys(players).length >= 2
            ? "レースをスタートできます！"
            : "あと1人以上必要です。";
    } else {
        document.getElementById('start-game-btn').style.display = 'none';
        document.getElementById('wait-host-msg').textContent = "ホストがスタートを押すと始まります。";
    }
}

window.hostStartGame = async function() {
    if (!isHost || isTransitioning) return;
    isTransitioning = true;
    const text = raceTexts[Math.floor(Math.random() * raceTexts.length)];
    const startTime = Date.now() + 4000; // 4 seconds from now (3s countdown + 1s buffer)
    const players = roomState.players || {};
    const updates = {};
    Object.keys(players).forEach(pid => {
        updates[`${RPATH(roomId)}/players/${pid}/progress`] = 0;
        updates[`${RPATH(roomId)}/players/${pid}/finishTime`] = 0;
    });
    updates[`${RPATH(roomId)}/phase`] = "racing";
    updates[`${RPATH(roomId)}/raceText`] = text;
    updates[`${RPATH(roomId)}/startTime`] = startTime;
    await update(ref(db), updates);
    isTransitioning = false;
};

// ===== RACING =====
let racingEntered = false;

function onRacingUpdate() {
    if (currentPhase !== "racing") {
        currentPhase = "racing";
        racingEntered = false;
        myFinished = false;
        showScreen("racing");
    }

    if (!racingEntered) {
        racingEntered = true;
        setupRaceText(roomState.raceText || "");
        startCountdownAndRace(roomState.startTime);
    }

    renderProgressBars();
    checkAllFinished();
}

function setupRaceText(text) {
    const display = document.getElementById('race-text-display');
    display.innerHTML = text.split('').map((ch, i) =>
        `<span class="char pending" id="char-${i}">${ch}</span>`
    ).join('');
}

function startCountdownAndRace(startTime) {
    const overlay = document.getElementById('countdown-overlay');
    const numEl = document.getElementById('countdown-number');
    overlay.style.display = 'flex';

    const tick = () => {
        const remaining = startTime - Date.now();
        if (remaining > 1000) {
            numEl.className = 'countdown-number';
            numEl.textContent = Math.ceil(remaining / 1000);
            void numEl.offsetWidth; // reflow for animation restart
            numEl.className = 'countdown-number';
        } else if (remaining > 0) {
            numEl.className = 'countdown-go';
            numEl.textContent = 'GO!';
        } else {
            overlay.style.display = 'none';
            raceStartTime = startTime;
            document.getElementById('type-input').disabled = false;
            document.getElementById('type-input').focus();
            document.getElementById('race-status-text').textContent = 'タイピング中！';
            startRaceTimer();
            return;
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

function startRaceTimer() {
    if (raceTimerInterval) clearInterval(raceTimerInterval);
    raceTimerInterval = setInterval(() => {
        if (roomState?.phase !== "racing") { clearInterval(raceTimerInterval); return; }
        const elapsed = (Date.now() - raceStartTime) / 1000;
        const el = document.getElementById('race-timer');
        if (el) el.textContent = elapsed.toFixed(1) + 's';
    }, 100);
}

window.onTypeInput = function() {
    if (myFinished) return;
    const now = Date.now();
    if (now < raceStartTime) return;

    const input = document.getElementById('type-input');
    const typed = input.value;
    const target = roomState.raceText || "";

    // Update character highlights
    for (let i = 0; i < target.length; i++) {
        const el = document.getElementById(`char-${i}`);
        if (!el) continue;
        if (i < typed.length) {
            el.className = 'char ' + (typed[i] === target[i] ? 'correct' : 'wrong');
        } else if (i === typed.length) {
            el.className = 'char current';
        } else {
            el.className = 'char pending';
        }
    }

    // Calculate progress (only count correct prefix)
    let correctCount = 0;
    for (let i = 0; i < Math.min(typed.length, target.length); i++) {
        if (typed[i] === target[i]) correctCount = i + 1;
        else break;
    }
    const progress = correctCount / target.length;

    // Throttle Firebase updates
    if (progressUpdateTimeout) clearTimeout(progressUpdateTimeout);
    progressUpdateTimeout = setTimeout(() => {
        update(ref(db, `${RPATH(roomId)}/players/${myPlayerId}`), { progress });
    }, 150);

    // Check if finished
    if (typed === target) {
        myFinished = true;
        input.disabled = true;
        clearInterval(raceTimerInterval);
        const finishTime = (now - raceStartTime) / 1000;
        update(ref(db, `${RPATH(roomId)}/players/${myPlayerId}`), {
            progress: 1,
            finishTime: finishTime
        });
        document.getElementById('race-status-text').textContent = `🎉 ゴール！ ${finishTime.toFixed(2)}秒！`;
    }
};

function renderProgressBars() {
    const players = roomState.players || {};
    const area = document.getElementById('progress-area');
    const sorted = Object.entries(players).sort(([, a], [, b]) => {
        if (b.progress !== a.progress) return b.progress - a.progress;
        if (a.finishTime && b.finishTime) return a.finishTime - b.finishTime;
        return 0;
    });

    const rankEmojis = ['🥇', '🥈', '🥉'];
    area.innerHTML = sorted.map(([id, p], idx) => {
        const pct = Math.round((p.progress || 0) * 100);
        const isMe = id === myPlayerId;
        const isFinished = p.finishTime > 0;
        const fillClass = isFinished ? 'finished' : (isMe ? 'me' : '');
        const timeLabel = isFinished ? ` (${p.finishTime.toFixed(2)}s)` : '';
        return `<div class="progress-row">
            <div class="rank-label">${rankEmojis[idx] || (idx + 1)}</div>
            <div class="player-name-label">${p.name}${isMe ? ' 👈' : ''}</div>
            <div class="progress-track">
                <div class="progress-fill ${fillClass}" style="width:${pct}%">
                    ${pct > 15 ? pct + '%' : ''}
                </div>
            </div>
            <div style="width:70px;font-size:12px;color:#7f8c8d;">${timeLabel}</div>
        </div>`;
    }).join('');
}

function checkAllFinished() {
    const players = roomState.players || {};
    const allDone = Object.values(players).every(p => p.finishTime > 0);
    if (allDone && isHost && !isTransitioning && roomState.phase === "racing") {
        isTransitioning = true;
        setTimeout(() => {
            update(ref(db, RPATH(roomId)), { phase: "result" }).then(() => { isTransitioning = false; });
        }, 2000);
    }
}

// ===== RESULT =====
function onResultUpdate() {
    if (currentPhase !== "result") {
        currentPhase = "result";
        if (raceTimerInterval) clearInterval(raceTimerInterval);
        document.getElementById('countdown-overlay').style.display = 'none';
        showScreen("result");
    }

    const players = roomState.players || {};
    const sorted = Object.entries(players).sort(([, a], [, b]) => {
        if (a.finishTime > 0 && b.finishTime > 0) return a.finishTime - b.finishTime;
        if (a.finishTime > 0) return -1;
        if (b.finishTime > 0) return 1;
        return b.progress - a.progress;
    });

    const rankBadges = ['rank-1', 'rank-2', 'rank-3'];
    document.getElementById('result-leaderboard').innerHTML = sorted.map(([id, p], idx) => {
        const timeLabel = p.finishTime > 0 ? `${p.finishTime.toFixed(2)}s` : `${Math.round((p.progress || 0) * 100)}%`;
        return `<div class="leaderboard-row">
            <div class="rank-badge ${rankBadges[idx] || ''}">${idx + 1}</div>
            <div class="leaderboard-name">${p.name}${id === myPlayerId ? ' 👈' : ''}</div>
            <div class="leaderboard-time">${timeLabel}</div>
        </div>`;
    }).join('');

    if (isHost) document.getElementById('restart-btn').style.display = 'inline-block';
}

window.restartGame = async function() {
    if (!isHost) return;
    racingEntered = false;
    isTransitioning = false;
    const players = roomState.players || {};
    const updates = {};
    Object.keys(players).forEach(pid => {
        updates[`${RPATH(roomId)}/players/${pid}/progress`] = 0;
        updates[`${RPATH(roomId)}/players/${pid}/finishTime`] = 0;
    });
    updates[`${RPATH(roomId)}/phase`] = "lobby";
    await update(ref(db), updates);
};
