import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update, get, push } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

const wordPairs = [
    { common: "犬", wolf: "猫" },
    { common: "ラーメン", wolf: "うどん" },
    { common: "海", wolf: "プール" },
    { common: "電車", wolf: "バス" },
    { common: "りんご", wolf: "なし" },
    { common: "サッカー", wolf: "バスケ" },
    { common: "夏", wolf: "冬" },
    { common: "先生", wolf: "親" },
    { common: "山", wolf: "丘" },
    { common: "スマホ", wolf: "タブレット" },
    { common: "牛乳", wolf: "豆乳" },
    { common: "映画館", wolf: "劇場" },
    { common: "寿司", wolf: "刺身" },
    { common: "コーラ", wolf: "サイダー" },
    { common: "ピアノ", wolf: "ギター" },
    { common: "お風呂", wolf: "シャワー" },
    { common: "クリスマス", wolf: "誕生日" },
    { common: "チョコレート", wolf: "キャラメル" },
    { common: "コンビニ", wolf: "スーパー" },
    { common: "図書館", wolf: "本屋" },
    { common: "公園", wolf: "広場" },
    { common: "運動会", wolf: "体育祭" },
    { common: "朝ご飯", wolf: "昼ご飯" },
    { common: "飛行機", wolf: "ヘリコプター" },
    { common: "サクラ", wolf: "ウメ" },
    { common: "カレーライス", wolf: "シチュー" },
    { common: "ドラえもん", wolf: "アンパンマン" },
    { common: "ハンバーガー", wolf: "サンドイッチ" },
    { common: "プール", wolf: "お風呂" },
    { common: "テスト", wolf: "宿題" },
];

const RPATH = (id) => `word-wolf-rooms/${id}`;

let roomId = "";
let myPlayerId = "";
let myPlayerName = "";
let myUserId = localStorage.getItem('userId') || "";
let myRole = "";
let myWord = "";
let isHost = false;
let roomState = null;
let currentPhase = "";
let timerInterval = null;
let isTransitioning = false;
let wordRevealInit = false;

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
        else isHost = (Object.keys(data.players || {}).length === 0);
    } else {
        isHost = true;
    }

    if (createNew) {
        isHost = true;
        await set(ref(db, RPATH(roomId)), {
            phase: "lobby",
            hostId: myPlayerId,
            createdAt: Date.now()
        });
    }

    await set(ref(db, `${RPATH(roomId)}/players/${myPlayerId}`), {
        name: myPlayerName, role: "", word: "", ready: false, vote: "", joinedAt: Date.now()
    });

    if (!snap.exists() || snap.val().phase === "result") {
        await update(ref(db, RPATH(roomId)), { hostId: myPlayerId });
    }

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
        else if (phase === "word_reveal") onWordRevealUpdate();
        else if (phase === "discussion") onDiscussionUpdate();
        else if (phase === "voting") onVotingUpdate();
        else if (phase === "result") onResultUpdate();
    });

    onValue(ref(db, `${RPATH(roomId)}/chat`), (snap) => {
        if (snap.exists()) renderChat(snap.val());
    });
}

// ===== LOBBY =====
function onLobbyUpdate() {
    if (currentPhase !== "lobby") {
        currentPhase = "lobby";
        wordRevealInit = false;
        isTransitioning = false;
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
        showScreen("lobby");
    }
    const players = roomState.players || {};
    const list = document.getElementById('lobby-players-list');
    list.innerHTML = Object.entries(players).map(([id, p]) =>
        `<div style="padding:5px 0;">${id === myPlayerId ? "🟢" : "⚪"} ${p.name}${id === roomState.hostId ? " 👑" : ""}</div>`
    ).join('');

    const count = Object.keys(players).length;
    if (myUserId) document.getElementById('lobby-invite-btn').style.display = 'inline-block';
    if (isHost) {
        const startBtn = document.getElementById('start-game-btn');
        const waitMsg = document.getElementById('wait-host-msg');
        if (count >= 3) {
            startBtn.style.display = 'inline-block';
            waitMsg.textContent = "準備完了！ゲームをスタートできます。";
        } else {
            startBtn.style.display = 'none';
            waitMsg.textContent = `まだ${3 - count}人足りません。合計3人以上必要です。`;
        }
    } else {
        document.getElementById('start-game-btn').style.display = 'none';
        document.getElementById('wait-host-msg').textContent = "ホストがスタートボタンを押すと始まります。";
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
                        gameType: "wordwolf",
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
    const players = roomState.players || {};
    const playerIds = Object.keys(players);
    if (playerIds.length < 3) { alert("最低3人必要です！"); return; }
    isTransitioning = true;

    const pair = wordPairs[Math.floor(Math.random() * wordPairs.length)];
    const wolfIndex = Math.floor(Math.random() * playerIds.length);
    const updates = {};
    playerIds.forEach((pid, i) => {
        const isWolf = i === wolfIndex;
        updates[`${RPATH(roomId)}/players/${pid}/role`] = isWolf ? "wolf" : "citizen";
        updates[`${RPATH(roomId)}/players/${pid}/word`] = isWolf ? pair.wolf : pair.common;
        updates[`${RPATH(roomId)}/players/${pid}/ready`] = false;
        updates[`${RPATH(roomId)}/players/${pid}/vote`] = "";
    });
    updates[`${RPATH(roomId)}/phase`] = "word_reveal";
    updates[`${RPATH(roomId)}/wordPair`] = pair;
    updates[`${RPATH(roomId)}/chat`] = null;
    await update(ref(db), updates);
    isTransitioning = false;
};

// ===== WORD REVEAL =====
function onWordRevealUpdate() {
    if (currentPhase !== "word_reveal") {
        currentPhase = "word_reveal";
        showScreen("word_reveal");
    }

    if (!wordRevealInit) {
        wordRevealInit = true;
        document.getElementById('word-cover').style.display = 'flex';
        document.getElementById('word-display').style.display = 'none';
        document.getElementById('ready-btn').style.display = 'none';
        const myData = roomState.players?.[myPlayerId];
        if (myData) { myRole = myData.role; myWord = myData.word; }
    }

    const players = roomState.players || {};
    document.getElementById('player-ready-list').innerHTML =
        Object.values(players).map(p => `<div style="padding:3px 0;">${p.ready ? "✅" : "⬜"} ${p.name}</div>`).join('');

    const allReady = Object.keys(players).length > 0 && Object.values(players).every(p => p.ready);
    if (allReady && isHost && !isTransitioning) {
        isTransitioning = true;
        const endTime = Date.now() + 3 * 60 * 1000;
        update(ref(db, RPATH(roomId)), { phase: "discussion", discussionEndTime: endTime })
            .then(() => { isTransitioning = false; });
    }
}

window.revealWord = function() {
    if (document.getElementById('word-display').style.display === 'block') return;
    document.getElementById('word-cover').style.display = 'none';
    document.getElementById('word-display').style.display = 'block';
    document.getElementById('your-word-text').textContent = myWord;
    const badge = document.getElementById('role-badge');
    if (myRole === "wolf") {
        badge.textContent = "🐺 あなたはウルフ！";
        badge.className = "role-badge wolf";
    } else {
        badge.textContent = "👥 市民";
        badge.className = "role-badge citizen";
    }
    document.getElementById('ready-btn').style.display = 'inline-block';
};

window.markReady = async function() {
    await update(ref(db, `${RPATH(roomId)}/players/${myPlayerId}`), { ready: true });
    document.getElementById('ready-btn').style.display = 'none';
    document.getElementById('waiting-others').textContent = "✅ 準備完了！他のプレイヤーを待っています...";
};

// ===== DISCUSSION =====
function onDiscussionUpdate() {
    if (currentPhase !== "discussion") {
        currentPhase = "discussion";
        showScreen("discussion");
        document.getElementById('reminder-word').textContent = myWord;
        startDiscussionTimer();
    }
    const players = roomState.players || {};
    document.getElementById('discussion-players-list').innerHTML =
        Object.values(players).map(p => `<div class="player-chip">${p.name}</div>`).join('');
}

function startDiscussionTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (!roomState || roomState.phase !== "discussion") { clearInterval(timerInterval); return; }
        const remaining = Math.max(0, roomState.discussionEndTime - Date.now());
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        const el = document.getElementById('timer-value');
        if (el) el.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
        if (remaining <= 0) {
            clearInterval(timerInterval);
            if (isHost && !isTransitioning) {
                isTransitioning = true;
                update(ref(db, RPATH(roomId)), { phase: "voting" }).then(() => { isTransitioning = false; });
            }
        }
    }, 500);
}

function renderChat(chatData) {
    const msgs = document.getElementById('chat-messages');
    if (!msgs) return;
    const entries = Object.values(chatData).sort((a, b) => a.ts - b.ts);
    msgs.innerHTML = entries.map(e => `<div class="message"><strong>${e.name}：</strong>${e.text}</div>`).join('');
    msgs.scrollTop = msgs.scrollHeight;
}

window.sendChat = async function() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await push(ref(db, `${RPATH(roomId)}/chat`), { name: myPlayerName, text, ts: Date.now() });
};

// ===== VOTING =====
function onVotingUpdate() {
    if (currentPhase !== "voting") {
        currentPhase = "voting";
        showScreen("voting");
        document.getElementById('vote-reminder-word').textContent = myWord;
    }
    const players = roomState.players || {};
    const myVote = players[myPlayerId]?.vote;
    document.getElementById('voting-players-list').innerHTML = Object.entries(players)
        .filter(([id]) => id !== myPlayerId)
        .map(([id, p]) => {
            const isVoted = myVote === id;
            return `<button class="vote-card${isVoted ? ' voted' : ''}" onclick="castVote('${id}')" ${myVote ? 'disabled' : ''}>
                👤 ${p.name}
                ${isVoted ? '<div style="font-size:11px;margin-top:4px;">✓ 投票済み</div>' : ''}
            </button>`;
        }).join('');
    const voteCount = Object.values(players).filter(p => p.vote).length;
    const total = Object.keys(players).length;
    document.getElementById('vote-status').textContent = `${voteCount} / ${total} 人が投票済み`;
    if (voteCount >= total && isHost && !isTransitioning) {
        isTransitioning = true;
        setTimeout(() => {
            update(ref(db, RPATH(roomId)), { phase: "result" }).then(() => { isTransitioning = false; });
        }, 1500);
    }
}

window.castVote = async function(targetId) {
    const players = roomState.players || {};
    if (players[myPlayerId]?.vote) return;
    await update(ref(db, `${RPATH(roomId)}/players/${myPlayerId}`), { vote: targetId });
};

// ===== RESULT =====
function onResultUpdate() {
    if (currentPhase !== "result") {
        currentPhase = "result";
        if (timerInterval) clearInterval(timerInterval);
        showScreen("result");
    }
    const players = roomState.players || {};
    const pair = roomState.wordPair || {};

    const voteCounts = {};
    Object.entries(players).forEach(([id, p]) => {
        if (p.vote) voteCounts[p.vote] = (voteCounts[p.vote] || 0) + 1;
    });

    let maxVotes = 0, mostVotedId = null;
    Object.entries(voteCounts).forEach(([id, c]) => { if (c > maxVotes) { maxVotes = c; mostVotedId = id; } });

    const wolfEntry = Object.entries(players).find(([, p]) => p.role === "wolf");
    const wolfId = wolfEntry?.[0];
    const wolfName = wolfEntry?.[1]?.name || "？";
    const citizensWin = mostVotedId === wolfId;

    document.getElementById('result-title').textContent = citizensWin ? "🎉 市民の勝ち！" : "🐺 ウルフの勝ち！";
    const badge = document.getElementById('result-winner-badge');
    badge.textContent = citizensWin ? "✅ ウルフを見つけ出した！" : "😈 ウルフが生き残った！";
    badge.className = `winner-badge ${citizensWin ? 'citizens-win' : 'wolf-wins'}`;

    document.getElementById('result-word-reveal').innerHTML = `
        <div>👥 市民のワード：<strong>${pair.common || '？'}</strong></div>
        <div style="margin-top:8px;">🐺 ウルフのワード：<strong>${pair.wolf || '？'}</strong></div>
        <div style="margin-top:12px;border-top:2px dashed #9c826b;padding-top:10px;">
            🐺 ウルフは <strong>${wolfName}</strong> でした！
        </div>
    `;

    document.getElementById('result-players-list').innerHTML = Object.entries(players).map(([id, p]) => {
        const votes = voteCounts[id] || 0;
        const isWolf = p.role === "wolf";
        return `<div class="result-player-row ${isWolf ? 'wolf' : ''}">
            <span>${isWolf ? "🐺" : "👤"} ${p.name}</span>
            <span>${votes}票</span>
            <span class="role-label ${isWolf ? 'wolf' : 'citizen'}">${isWolf ? "ウルフ" : "市民"}</span>
        </div>`;
    }).join('');

    if (isHost) document.getElementById('restart-btn').style.display = 'inline-block';
}

window.restartGame = async function() {
    if (!isHost) return;
    wordRevealInit = false;
    isTransitioning = false;
    const players = roomState.players || {};
    const updates = {};
    Object.keys(players).forEach(pid => {
        updates[`${RPATH(roomId)}/players/${pid}/role`] = "";
        updates[`${RPATH(roomId)}/players/${pid}/word`] = "";
        updates[`${RPATH(roomId)}/players/${pid}/ready`] = false;
        updates[`${RPATH(roomId)}/players/${pid}/vote`] = "";
    });
    updates[`${RPATH(roomId)}/phase`] = "lobby";
    updates[`${RPATH(roomId)}/chat`] = null;
    await update(ref(db), updates);
};
