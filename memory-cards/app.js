import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, push, onValue, update, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

const EMOJI_POOL = [
    "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯",
    "🦁","🐮","🐷","🐸","🐵","🐔","🐧","🐦","🦆","🦉",
    "🦋","🐛","🐌","🐞","🐝","🦄","🐲","🌸","🌺","🌻",
    "🍎","🍊","🍋","🍇","🍓","🍑","🍒","🥝","🍉","🍌",
    "🎈","🎉","⭐","🌈","☀️","🌙","❤️","💎","🏆","🎯",
];

const PAIRS = 15; // 15 pairs = 30 cards (6 × 5 grid)
const RPATH = (id) => `memory-card-rooms/${id}`;
const FLIP_DELAY = 1200; // ms to show wrong flip before hiding

let roomId = "";
let myPlayerId = "";
let myPlayerName = "";
let myUserId = localStorage.getItem('userId') || "";
let isHost = false;
let roomState = null;
let currentPhase = "";
let isTransitioning = false;
let pendingFlip = false; // prevent double-click during flip animation

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
        else if (phase === "playing") onPlayingUpdate();
        else if (phase === "result") onResultUpdate();
    });
}

// ===== LOBBY =====
function onLobbyUpdate() {
    if (currentPhase !== "lobby") {
        currentPhase = "lobby";
        isTransitioning = false;
        pendingFlip = false;
        showScreen("lobby");
    }
    const players = roomState.players || {};
    document.getElementById('lobby-players-list').innerHTML = Object.entries(players).map(([id, p]) =>
        `<div style="padding:5px 0;">${id === myPlayerId ? "🟢" : "⚪"} ${p.name}${id === roomState.hostId ? " 👑" : ""}</div>`
    ).join('');

    if (myUserId) document.getElementById('lobby-invite-btn').style.display = 'inline-block';
    if (isHost) {
        document.getElementById('start-game-btn').style.display = Object.keys(players).length >= 2 ? 'inline-block' : 'none';
        document.getElementById('wait-host-msg').textContent = Object.keys(players).length >= 2 ? "ゲームをスタートできます！" : "あと1人以上必要です。";
    } else {
        document.getElementById('start-game-btn').style.display = 'none';
        document.getElementById('wait-host-msg').textContent = "ホストがスタートを押すと始まります。";
    }
}

window.openLobbyInviteModal = function() {
    const modal = document.getElementById('lobby-invite-modal');
    modal.style.display = "flex";
    const listEl = document.getElementById('lobby-invite-friends-list');
    listEl.innerHTML = '<div style="color:#7f8c8d;font-size:12px;text-align:center;">読み込み中...</div>';
    if (!myUserId) {
        listEl.innerHTML = '<div style="color:#7f8c8d;font-size:12px;text-align:center;">ポータルでアカウント登録するとフレンド招待ができます。</div>';
        return;
    }
    get(ref(db, `users/${myUserId}/friends`)).then((snapshot) => {
        const friends = snapshot.val();
        if (!friends) {
            listEl.innerHTML = '<div style="color:#7f8c8d;font-size:12px;text-align:center;">フレンドがまだいません。</div>';
            return;
        }
        listEl.innerHTML = "";
        Object.keys(friends).forEach(friendId => {
            get(ref(db, `users/${friendId}`)).then((fSnap) => {
                const fp = fSnap.val();
                if (!fp) return;
                const isOnline = fp.status !== "offline" && (Date.now() - fp.lastActive < 45000);
                const item = document.createElement('div');
                item.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:white;border:1px solid #d3c9b8;border-radius:8px;font-size:13px;";
                const nameSpan = document.createElement('span');
                nameSpan.textContent = fp.name;
                nameSpan.style.cssText = "font-weight:bold;color:#4a3b32;";
                const btn = document.createElement('button');
                btn.textContent = isOnline ? "招待" : "オフライン";
                btn.disabled = !isOnline;
                btn.style.cssText = `padding:4px 10px;font-size:11px;border-radius:12px;background-color:${isOnline ? '#2ecc71' : '#bdc3c7'};border-bottom:${isOnline ? '3px solid #27ae60' : 'none'};color:white;border-top:none;border-left:none;border-right:none;cursor:${isOnline ? 'pointer' : 'default'};font-weight:bold;`;
                btn.onclick = () => {
                    btn.textContent = "送信済";
                    btn.disabled = true;
                    btn.style.backgroundColor = "#7f8c8d";
                    btn.style.borderBottom = "none";
                    set(push(ref(db, `users/${friendId}/invites`)), {
                        fromName: myPlayerName,
                        roomId: roomId,
                        gameType: "memory",
                        timestamp: Date.now()
                    });
                };
                item.appendChild(nameSpan);
                item.appendChild(btn);
                listEl.appendChild(item);
            });
        });
    });
};

window.hostStartGame = async function() {
    if (!isHost || isTransitioning) return;
    isTransitioning = true;

    // Build shuffled card deck
    const emojis = [...EMOJI_POOL].sort(() => Math.random() - 0.5).slice(0, PAIRS);
    const deck = [...emojis, ...emojis].sort(() => Math.random() - 0.5);
    const cards = deck.map((emoji, i) => ({ id: i, emoji, faceUp: false, matchedBy: "" }));

    // Turn order: all player IDs in join order
    const players = roomState.players || {};
    const turnOrder = Object.entries(players).sort(([, a], [, b]) => a.joinedAt - b.joinedAt).map(([id]) => id);

    const updates = {};
    Object.keys(players).forEach(pid => { updates[`${RPATH(roomId)}/players/${pid}/score`] = 0; });
    updates[`${RPATH(roomId)}/cards`] = cards;
    updates[`${RPATH(roomId)}/turnOrder`] = turnOrder;
    updates[`${RPATH(roomId)}/currentTurnIdx`] = 0;
    updates[`${RPATH(roomId)}/flipped`] = [];
    updates[`${RPATH(roomId)}/phase`] = "playing";
    await update(ref(db), updates);
    isTransitioning = false;
};

// ===== PLAYING =====
let playingEntered = false;

function onPlayingUpdate() {
    if (currentPhase !== "playing") {
        currentPhase = "playing";
        playingEntered = false;
        showScreen("playing");
    }
    renderCards();
    renderScores();
    updateTurnIndicator();
    checkGameOver();
}

function renderCards() {
    const cards = roomState.cards || [];
    const flipped = roomState.flipped || [];
    const grid = document.getElementById('card-grid');
    if (!grid) return;

    const turnOrder = roomState.turnOrder || [];
    const currentTurnId = turnOrder[roomState.currentTurnIdx || 0];
    const isMyTurn = currentTurnId === myPlayerId && !pendingFlip;

    grid.innerHTML = cards.map((card, i) => {
        const isFaceUp = card.faceUp || flipped.includes(i) || !!card.matchedBy;
        const isMatched = !!card.matchedBy;
        const isCurrentFlip = flipped.includes(i) && !isMatched;
        let cls = 'card';
        if (isMatched) cls += ' matched';
        else if (isFaceUp) cls += ' face-up';
        const clickable = isMyTurn && !isFaceUp && !isMatched;
        return `<div class="${cls}" id="card-${i}" ${clickable ? `onclick="flipCard(${i})"` : ''}>
            ${isFaceUp ? `<span class="card-emoji">${card.emoji}</span>` : ''}
        </div>`;
    }).join('');

    // Remaining pairs count
    const matched = cards.filter(c => !!c.matchedBy).length / 2;
    const remaining = PAIRS - matched;
    const remEl = document.getElementById('remaining-pairs');
    if (remEl) remEl.textContent = remaining;
}

function updateTurnIndicator() {
    const turnOrder = roomState.turnOrder || [];
    const currentTurnId = turnOrder[roomState.currentTurnIdx || 0];
    const players = roomState.players || {};
    const currentName = players[currentTurnId]?.name || "？";
    const el = document.getElementById('turn-indicator');
    if (!el) return;
    if (currentTurnId === myPlayerId) {
        el.textContent = "🟢 あなたのターン！";
        el.className = "turn-indicator my-turn";
    } else {
        el.textContent = `⌛ ${currentName} のターン`;
        el.className = "turn-indicator";
    }
}

function renderScores() {
    const players = roomState.players || {};
    const turnOrder = roomState.turnOrder || [];
    const currentTurnId = turnOrder[roomState.currentTurnIdx || 0];
    const sorted = Object.entries(players).sort(([, a], [, b]) => b.score - a.score);
    document.getElementById('score-list').innerHTML = sorted.map(([id, p]) =>
        `<div class="player-score-row${id === currentTurnId ? ' active-turn' : ''}">
            <span>${p.name}${id === myPlayerId ? ' 👈' : ''}${id === currentTurnId ? ' ▶' : ''}</span>
            <span class="score-val">${p.score}</span>
        </div>`
    ).join('');
}

window.flipCard = async function(cardIdx) {
    if (pendingFlip) return;
    const turnOrder = roomState.turnOrder || [];
    const currentTurnId = turnOrder[roomState.currentTurnIdx || 0];
    if (currentTurnId !== myPlayerId) return;

    const cards = roomState.cards || [];
    const flipped = roomState.flipped || [];
    const card = cards[cardIdx];
    if (!card || card.matchedBy || card.faceUp || flipped.includes(cardIdx)) return;

    const newFlipped = [...flipped, cardIdx];

    if (newFlipped.length === 1) {
        // First flip
        await update(ref(db, RPATH(roomId)), { flipped: newFlipped });
    } else if (newFlipped.length === 2) {
        // Second flip — check match
        pendingFlip = true;
        await update(ref(db, RPATH(roomId)), { flipped: newFlipped });

        const [i1, i2] = newFlipped;
        const match = cards[i1].emoji === cards[i2].emoji;

        setTimeout(async () => {
            const updates = {};
            if (match) {
                // Mark both matched
                updates[`${RPATH(roomId)}/cards/${i1}/matchedBy`] = myPlayerId;
                updates[`${RPATH(roomId)}/cards/${i2}/matchedBy`] = myPlayerId;
                updates[`${RPATH(roomId)}/cards/${i1}/faceUp`] = true;
                updates[`${RPATH(roomId)}/cards/${i2}/faceUp`] = true;
                const currentScore = roomState.players?.[myPlayerId]?.score || 0;
                updates[`${RPATH(roomId)}/players/${myPlayerId}/score`] = currentScore + 1;
                updates[`${RPATH(roomId)}/flipped`] = [];
                // Stay on turn (don't advance)
            } else {
                // No match — advance turn
                const nextIdx = ((roomState.currentTurnIdx || 0) + 1) % turnOrder.length;
                updates[`${RPATH(roomId)}/currentTurnIdx`] = nextIdx;
                updates[`${RPATH(roomId)}/flipped`] = [];
            }
            await update(ref(db), updates);
            pendingFlip = false;
        }, FLIP_DELAY);
    }
};

function checkGameOver() {
    const cards = roomState.cards || [];
    if (cards.length === 0) return;
    const allMatched = cards.every(c => !!c.matchedBy);
    if (allMatched && isHost && !isTransitioning) {
        isTransitioning = true;
        setTimeout(() => {
            update(ref(db, RPATH(roomId)), { phase: "result" }).then(() => { isTransitioning = false; });
        }, 1000);
    }
}

// ===== RESULT =====
function onResultUpdate() {
    if (currentPhase !== "result") {
        currentPhase = "result";
        showScreen("result");
    }
    const players = roomState.players || {};
    const sorted = Object.entries(players).sort(([, a], [, b]) => b.score - a.score);
    const rankBadges = ['rank-1', 'rank-2', 'rank-3'];
    document.getElementById('result-leaderboard').innerHTML = sorted.map(([id, p], idx) =>
        `<div class="leaderboard-row">
            <div class="rank-badge ${rankBadges[idx] || ''}">${idx + 1}</div>
            <div class="leaderboard-name">${p.name}${id === myPlayerId ? ' 👈' : ''}</div>
            <div class="leaderboard-score">${p.score}ペア</div>
        </div>`
    ).join('');
    if (isHost) document.getElementById('restart-btn').style.display = 'inline-block';
}

window.restartGame = async function() {
    if (!isHost) return;
    isTransitioning = false;
    playingEntered = false;
    pendingFlip = false;
    const players = roomState.players || {};
    const updates = {};
    Object.keys(players).forEach(pid => { updates[`${RPATH(roomId)}/players/${pid}/score`] = 0; });
    updates[`${RPATH(roomId)}/phase`] = "lobby";
    updates[`${RPATH(roomId)}/cards`] = null;
    updates[`${RPATH(roomId)}/flipped`] = null;
    await update(ref(db), updates);
};
