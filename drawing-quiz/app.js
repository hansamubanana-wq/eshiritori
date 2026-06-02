import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update, get, push, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

// お題ワードバンク
const wordBank = [
    // --- 動物・生き物 (Animals & Creatures) ---
    "ねこ", "いぬ", "キリン", "ぞう", "さかな", "ペンギン", "タコ", "イカ",
    "ぱんだ", "こあら", "らいおん", "とら", "うさぎ", "くま", "かえる", "さる",
    "うし", "ぶた", "ひよこ", "にわとり", "はむすたー", "いるか", "くじら", "かめ",
    "らっこ", "りす", "かんがるー", "きつね", "たぬき", "さめ", "かに", "かたつむり",
    "てんとうむし", "はち", "ちょうちょ", "あり", "りゅう", "きょうりゅう",
    
    // --- 食べ物・飲み物 (Foods & Drinks) ---
    "りんご", "バナナ", "すいか", "さくらんぼ", "ハンバーガー", "ピザ", "オムライス", "おにぎり",
    "いちご", "めろん", "ぶどう", "みかん", "もも", "くり", "けーき", "どーなつ",
    "あいすくりーむ", "ぱふぇ", "らーめん", "かれーらいす", "すし", "ぷりん", "ちょこれーと", "くっきー",
    "ぽてと", "さんどいっち", "たこやき", "くれーぷ", "めだまやき", "ぎゅうにゅう", "じゅーす",
    
    // --- 乗り物 (Vehicles) ---
    "くるま", "ひこうき", "じてんしゃ", "ぱとかー", "しょうぼうしゃ", "きゅうきゅうしゃ",
    "でんしゃ", "しんかんせん", "ふね", "へりこぷたー", "ばいく", "とらっく", "ろけっと",
    
    // --- 日用品・おもちゃ (Everyday Items & Toys) ---
    "テレビ", "メガネ", "ぼうし", "かさ", "えんぴつ", "くつ",
    "すまほ", "ぱそこん", "かめら", "とけい", "ぴあの", "どらむ", "ぎたー", "はさみ",
    "とらんぷ", "らんどせる", "じょうろ", "ふうせん", "かぎ", "くつした", "いす", "てーぶる",
    "すぷーん", "ふぉーく", "こっぷ", "ぼーる", "えほん", "ぬいぐるみ", "はぶらし", "かご",
    
    // --- 自然・宇宙・季節 (Nature, Space & Seasons) ---
    "ゆきだるま", "ひまわり", "チューリップ",
    "たいよう", "つき", "ほし", "くも", "にじ", "かざん", "ふじさん", "ゆき", "さくら",
    "さぼてん", "きのこ", "どんぐり", "かいがら", "うみ", "かわ", "はっぱ",
    
    // --- 人物・キャラクター・職業 (People, Characters & Occupations) ---
    "ドラえもん", "アンパンマン", "おばけ",
    "けいさつかん", "まほうつかい", "うちゅうじん", "ろぼっと", "にんじゃ", "おひめさま", "さんたくろーす",
    "あくま", "てんし", "おうかん", "かいぞく", "ゆうれい", "みいら", "おおかみおとこ", "どくろ",
    "おうじさま", "どろぼう", "おうかん",
    
    // --- 建物・場所 (Buildings & Places) ---
    "いえ", "おしろ", "とりい", "ぴらみっど", "こうえん", "がっこう", "はし",
    
    // --- スポーツ・遊び (Sports & Play) ---
    "さっかーぼーる", "やきゅう", "てにすらけっと", "うきわ", "すのぼ", "なわとび", "すべりだい", "ぶらんこ"
];

let roomId = "";
let myPlayerName = "";
let myPlayerId = "";
let myUserId = localStorage.getItem('userId') || "";
let isHost = false;
let roomState = null;
let sendCanvasTimeout = null;
let countdownInterval = null;
let isTransitioningRound = false;
let lastDrawnRoundIndex = -1;

// アカウント名自動入力とURLクエリによる自動入室
document.addEventListener("DOMContentLoaded", () => {
    const savedName = localStorage.getItem('username');
    if (savedName) {
        document.getElementById('user-name').value = savedName;
    }
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
        document.getElementById('room-id').value = roomParam;
        if (savedName) {
            setTimeout(() => {
                window.connectLobby();
            }, 300);
        }
    }
});

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let isDrawing = false;
let currentColor = '#4a3b32';
let currentLineWidth = 4;
let isEraserMode = false;

function changeScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

// 接続処理
window.connectLobby = function() {
    myPlayerName = document.getElementById('user-name').value.trim();
    roomId = document.getElementById('room-id').value.trim();
    if(!myPlayerName || !roomId) {
        alert("なまえ と 部屋パスワード をいれてね！");
        return;
    }
    myPlayerId = "p_" + Math.random().toString(36).substring(2, 10);
    
    const roomRef = ref(db, 'rooms-quiz/' + roomId);
    get(roomRef).then((snapshot) => {
        if (snapshot.exists()) {
            let data = snapshot.val();
            // 古い・または終了した部屋の場合はホストがリセット
            if (data.status === "result" || data.status === "playing") {
                isHost = true;
                createRoom(); 
            } else {
                isHost = false;
                joinRoom();
            }
        } else {
            isHost = true;
            createRoom();
        }
    });
}

function createRoom() {
    const roomRef = ref(db, 'rooms-quiz/' + roomId);
    const initialData = {
        status: "waiting",
        currentIndex: 0,
        currentWord: "",
        timerEnd: 0,
        playersOrder: [myPlayerId],
        players: {
            [myPlayerId]: { name: myPlayerName, isHost: true, score: 0, guessedCorrectly: false }
        },
        canvasData: ""
    };

    set(roomRef, initialData).then(() => {
        listenToRoom();
        changeScreen('screen-lobby');
        if (myUserId) {
            update(ref(db, `users/${myUserId}`), { status: "playing_quiz" });
        }
    });
}

function joinRoom() {
    const playerRef = ref(db, `rooms-quiz/${roomId}/players/${myPlayerId}`);
    set(playerRef, { name: myPlayerName, isHost: false, score: 0, guessedCorrectly: false }).then(() => {
        get(ref(db, 'rooms-quiz/' + roomId)).then((snapshot) => {
            let data = snapshot.val();
            let order = data.playersOrder || [];
            if (!order.includes(myPlayerId)) {
                order.push(myPlayerId);
            }
            update(ref(db, 'rooms-quiz/' + roomId), { playersOrder: order });
        });
        
        listenToRoom();
        changeScreen('screen-lobby');
        if (myUserId) {
            update(ref(db, `users/${myUserId}`), { status: "playing_quiz" });
        }
    });
}

// 部屋の状態監視
function listenToRoom() {
    const roomRef = ref(db, 'rooms-quiz/' + roomId);
    onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
        
        // 新しいラウンドやステータス変更を検知して遷移フラグをリセット
        if (roomState && data.status === "playing") {
            if (roomState.status !== "playing" || roomState.currentIndex !== data.currentIndex || roomState.drawerId !== data.drawerId) {
                isTransitioningRound = false;
            }
            if (roomState.status !== "playing") {
                lastDrawnRoundIndex = -1;
            }
        }
        
        roomState = data;

        if (data.status === "waiting") {
            document.getElementById('lobby-room-title').innerText = `部屋パスワード: ${roomId}`;
            const listEl = document.getElementById('lobby-players-list');
            listEl.innerHTML = "";
            if (data.playersOrder && data.players) {
                data.playersOrder.forEach(pId => {
                    const p = data.players[pId];
                    if (p) {
                        const li = document.createElement('div');
                        li.innerText = `・ ${p.name} ${p.isHost ? '👑(ホスト)' : ''}`;
                        listEl.appendChild(li);
                    }
                });
            }
            if (myUserId) {
                document.getElementById('lobby-invite-btn').style.display = 'inline-block';
            }
            document.getElementById('start-game-btn').style.display = isHost ? 'inline-block' : 'none';
            changeScreen('screen-lobby');
        }
        
        if (data.status === "playing") {
            syncGameFlow();
        }

        if (data.status === "result") {
            showResultView();
        }
    });

    // メッセージの監視
    const messagesRef = ref(db, `rooms-quiz/${roomId}/messages`);
    onValue(messagesRef, (snapshot) => {
        const messages = snapshot.val();
        const chatEl = document.getElementById('chat-messages');
        chatEl.innerHTML = "";
        if (messages) {
            Object.keys(messages).forEach(mId => {
                const msg = messages[mId];
                const msgDiv = document.createElement('div');
                msgDiv.className = `message ${msg.type || ''}`;
                msgDiv.innerText = msg.type === 'system' || msg.type === 'correct'
                    ? msg.text 
                    : `${msg.sender}: ${msg.text}`;
                chatEl.appendChild(msgDiv);
            });
            chatEl.scrollTop = chatEl.scrollHeight;
        }
    });
}

// ゲームスタート
window.hostStartGame = function() {
    if(!isHost) return;
    
    if (!roomState || !roomState.playersOrder || roomState.playersOrder.length < 2) {
        alert("お絵描きクイズを遊ぶには2人以上の参加者が必要です！");
        return;
    }
    
    // プレイヤーの初期スコアと状態をリセット
    const updates = {};
    roomState.playersOrder.forEach(pId => {
        updates[`players/${pId}/score`] = 0;
        updates[`players/${pId}/guessedCorrectly`] = false;
    });
    updates['status'] = "playing";
    updates['currentIndex'] = 0;
    
    update(ref(db, 'rooms-quiz/' + roomId), updates).then(() => {
        startNextRound();
    });
}

// 次のラウンドへ移行
function startNextRound() {
    const order = roomState.playersOrder;
    const curIdx = roomState.currentIndex;
    
    if (curIdx >= order.length * 2) { // 全員が2回ずつ描いたら終了
        update(ref(db, 'rooms-quiz/' + roomId), { status: "result" });
        return;
    }

    const nextDrawerId = order[curIdx % order.length];
    const randomWord = wordBank[Math.floor(Math.random() * wordBank.length)];
    const timeLimit = Date.now() + 60 * 1000; // 60秒

    const updates = {
        drawerId: nextDrawerId,
        currentWord: randomWord,
        timerEnd: timeLimit,
        canvasData: ""
    };

    // 全員の正解フラグをリセット
    order.forEach(pId => {
        updates[`players/${pId}/guessedCorrectly`] = false;
    });

    update(ref(db, 'rooms-quiz/' + roomId), updates).then(() => {
        // システムメッセージ送信
        const nextDrawerName = roomState.players[nextDrawerId].name;
        sendSystemMessage(`【第 ${curIdx + 1} ラウンド】${nextDrawerName} さんがお絵描きする番です！`);
    });
}

// システムメッセージ送信
function sendSystemMessage(text, type = "system") {
    const messagesRef = ref(db, `rooms-quiz/${roomId}/messages`);
    push(messagesRef, {
        sender: "システム",
        text: text,
        type: type,
        timestamp: Date.now()
    });
}

// ゲーム画面同期
function syncGameFlow() {
    const isMyTurn = roomState.drawerId === myPlayerId;
    
    // 画面切り替え
    changeScreen('screen-game');
    
    // ロール表示
    const roleText = document.getElementById('role-text');
    const drawingPanel = document.getElementById('drawer-controls');
    const guesserPanel = document.getElementById('guesser-controls');
    const canvasEl = document.getElementById('canvas');
    const liveImg = document.getElementById('live-stream-view');
    const wordBox = document.getElementById('word-box');

    // スコアボード更新
    updateScoreboard();

    // タイマー開始
    syncTimer();

    if (isMyTurn) {
        roleText.innerText = "あなたは お絵描き 担当です！";
        roleText.style.color = "#e67e22";
        drawingPanel.style.display = "block";
        guesserPanel.style.display = "none";
        canvasEl.style.display = "block";
        liveImg.style.display = "none";
        
        wordBox.className = "secret-word-display";
        wordBox.innerText = `お題：${roomState.currentWord}`;

        // 新しいラウンドの開始時のみキャンバスを白でクリア
        if (lastDrawnRoundIndex !== roomState.currentIndex) {
            lastDrawnRoundIndex = roomState.currentIndex;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            syncCanvasToFirebase();
        }

        // 描画イベントの登録
        setupCanvasEvents();
    } else {
        const drawerName = roomState.players[roomState.drawerId] ? roomState.players[roomState.drawerId].name : "ゲスト";
        roleText.innerText = `${drawerName} さんが描いています...`;
        roleText.style.color = "#2980b9";
        drawingPanel.style.display = "none";
        guesserPanel.style.display = "block";
        canvasEl.style.display = "none";
        liveImg.style.display = "block";
        
        // お題の文字数を表示
        wordBox.className = "secret-word-guesser";
        wordBox.innerText = `${roomState.currentWord.length}文字`;

        if (roomState.canvasData) {
            liveImg.src = roomState.canvasData;
        } else {
            // 白塗りの初期画像
            liveImg.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='380' height='380'><rect width='380' height='380' fill='white'/><text x='130' y='200' font-size='20' fill='%23ccc'>キャンバス準備中...</text></svg>";
        }
    }
}

// スコアボードの更新
function updateScoreboard() {
    const listEl = document.getElementById('score-list');
    listEl.innerHTML = "";
    
    if (roomState.playersOrder && roomState.players) {
        roomState.playersOrder.forEach(pId => {
            const p = roomState.players[pId];
            if (p) {
                const div = document.createElement('div');
                div.className = "score-row";
                if (pId === roomState.drawerId) {
                    div.classList.add('drawer');
                }
                if (p.guessedCorrectly) {
                    div.classList.add('guessed');
                }
                
                div.innerHTML = `
                    <span>${pId === roomState.drawerId ? '✍ ' : ''}${p.name}</span>
                    <span>${p.score} pt</span>
                `;
                listEl.appendChild(div);
            }
        });
    }
}

// タイマー同期処理
function syncTimer() {
    if (countdownInterval) clearInterval(countdownInterval);
    
    const timerEl = document.getElementById('timer-value');
    
    countdownInterval = setInterval(() => {
        const timeLeft = Math.max(0, Math.round((roomState.timerEnd - Date.now()) / 1000));
        timerEl.innerText = `${timeLeft} 秒`;
        
        if (timeLeft <= 0) {
            clearInterval(countdownInterval);
            handleTimeOver();
        }
    }, 1000);
}

// タイムオーバー時の処理
function handleTimeOver() {
    if (isTransitioningRound) return;
    
    // ホストまたは描き手が次のラウンドへの移行を指示
    if (myPlayerId === roomState.drawerId) {
        isTransitioningRound = true;
        sendSystemMessage(`時間切れ！正解は「${roomState.currentWord}」でした。`, "system");
        
        // 1.5秒待ってから次のターンへ
        setTimeout(() => {
            const nextIdx = roomState.currentIndex + 1;
            update(ref(db, 'rooms-quiz/' + roomId), { currentIndex: nextIdx }).then(() => {
                startNextRound();
            });
        }, 1500);
    }
}

// 回答の送信
window.submitGuess = function() {
    const guessInput = document.getElementById('guess-input');
    const guessText = guessInput.value.trim();
    if (!guessText) return;
    
    guessInput.value = "";

    // すでに正解している場合は何もしない
    if (roomState.players[myPlayerId].guessedCorrectly) {
        return;
    }

    const normalizedGuess = kataToHira(guessText);
    const normalizedTarget = kataToHira(roomState.currentWord);

    if (normalizedGuess === normalizedTarget) {
        // 正解！
        const newScore = (roomState.players[myPlayerId].score || 0) + 100;
        const drawerId = roomState.drawerId;
        const newDrawerScore = (roomState.players[drawerId].score || 0) + 50;

        const updates = {};
        updates[`players/${myPlayerId}/score`] = newScore;
        updates[`players/${myPlayerId}/guessedCorrectly`] = true;
        updates[`players/${drawerId}/score`] = newDrawerScore;

        update(ref(db, 'rooms-quiz/' + roomId), updates).then(() => {
            sendSystemMessage(`🎉 ${myPlayerName} さんが正解しました！ (+100pt / 描き手 +50pt)`, "correct");

            // 全員が正解したかチェック
            checkAllGuessed();
        });
    } else {
        // 不正解チャット送信
        const messagesRef = ref(db, `rooms-quiz/${roomId}/messages`);
        push(messagesRef, {
            sender: myPlayerName,
            text: guessText,
            type: "chat",
            timestamp: Date.now()
        });
    }
}

// 全員が正解したかの判定
function checkAllGuessed() {
    if (isTransitioningRound) return;

    get(ref(db, 'rooms-quiz/' + roomId)).then((snapshot) => {
        const data = snapshot.val();
        let allCorrect = true;
        
        data.playersOrder.forEach(pId => {
            if (pId !== data.drawerId && !data.players[pId].guessedCorrectly) {
                allCorrect = false;
            }
        });

        if (allCorrect) {
            isTransitioningRound = true;
            sendSystemMessage("全員正解しました！次のラウンドに進みます。", "system");
            if (countdownInterval) clearInterval(countdownInterval);
            
            setTimeout(() => {
                const nextIdx = data.currentIndex + 1;
                update(ref(db, 'rooms-quiz/' + roomId), { currentIndex: nextIdx }).then(() => {
                    startNextRound();
                });
            }, 1500);
        }
    });
}

// 結果画面の表示
function showResultView() {
    changeScreen('screen-result');
    
    // スコア降順に並び替え
    const players = roomState.players;
    const sortedPlayers = roomState.playersOrder
        .map(pId => ({ id: pId, name: players[pId].name, score: players[pId].score }))
        .sort((a, b) => b.score - a.score);

    const listEl = document.getElementById('leaderboard-list');
    listEl.innerHTML = "";

    sortedPlayers.forEach((p, idx) => {
        const row = document.createElement('div');
        row.className = "leaderboard-row";
        
        let rankClass = "";
        if (idx === 0) rankClass = "rank-1";
        else if (idx === 1) rankClass = "rank-2";
        else if (idx === 2) rankClass = "rank-3";

        row.innerHTML = `
            <div class="rank-badge ${rankClass}">${idx + 1}</div>
            <div class="leaderboard-name">${p.name}</div>
            <div class="leaderboard-score">${p.score} pt</div>
        `;
        listEl.appendChild(row);
    });

    document.getElementById('restart-game-btn').style.display = isHost ? 'inline-block' : 'none';
}

// ゲームの再スタート
window.restartQuizGame = function() {
    if (!isHost) return;
    
    // メッセージ履歴をクリア
    const messagesRef = ref(db, `rooms-quiz/${roomId}/messages`);
    remove(messagesRef).then(() => {
        hostStartGame();
    });
}

// お絵描きキャンバス処理
window.clearCanvas = function() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    syncCanvasToFirebase();
}

function syncCanvasToFirebase() {
    if (sendCanvasTimeout) clearTimeout(sendCanvasTimeout);
    
    sendCanvasTimeout = setTimeout(() => {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.4);
        update(ref(db, 'rooms-quiz/' + roomId), { canvasData: dataUrl });
    }, 30);
}

window.selectColor = function(color, element) {
    isEraserMode = false; currentColor = color;
    document.getElementById('eraser-btn').classList.remove('selected');
    document.querySelectorAll('.color-dot').forEach(dot => dot.classList.remove('selected'));
    element.classList.add('selected');
}

window.selectEraser = function() {
    isEraserMode = true;
    document.querySelectorAll('.color-dot').forEach(dot => dot.classList.remove('selected'));
    document.getElementById('eraser-btn').classList.add('selected');
    currentLineWidth = 20;
    document.getElementById('line-width-select').value = "20";
}

window.selectWidth = function(width) { currentLineWidth = parseInt(width); }

function setupCanvasEvents() {
    function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * (canvas.width / rect.width),
            y: (clientY - rect.top) * (canvas.height / rect.height)
        };
    }
    
    // 二重登録防止のためイベントを一旦リセットしてから再バインド
    canvas.onmousedown = canvas.ontouchstart = function(e) {
        isDrawing = true; const pos = getPos(e); ctx.beginPath(); ctx.moveTo(pos.x, pos.y);
    };
    canvas.onmousemove = canvas.ontouchmove = function(e) {
        if (!isDrawing) return; e.preventDefault(); const pos = getPos(e);
        ctx.lineWidth = currentLineWidth; ctx.lineCap = 'round';
        ctx.strokeStyle = isEraserMode ? '#ffffff' : currentColor;
        ctx.lineTo(pos.x, pos.y); ctx.stroke();
        
        syncCanvasToFirebase();
    };
    canvas.onmouseup = canvas.onmouseleave = canvas.ontouchend = function() { 
        if (isDrawing) {
            isDrawing = false; 
            syncCanvasToFirebase();
        }
    };
}

// 日本語のひらがな・カタカナ正規化
function kataToHira(str) {
    return str
        .replace(/[\u30a1-\u30f6]/g, match => String.fromCharCode(match.charCodeAt(0) - 0x60)) // カタカナをひらがなに変換
        .replace(/\s+/g, "") // 空白を除去
        .toLowerCase();
}

// フレンドをロビーに招待する処理
window.openLobbyInviteModal = function() {
    const modal = document.getElementById('lobby-invite-modal');
    modal.style.display = "flex";
    
    const listEl = document.getElementById('lobby-invite-friends-list');
    listEl.innerHTML = '<div style="color: #7f8c8d; font-size: 12px; text-align: center;">読み込み中...</div>';
    
    if (!myUserId) {
        listEl.innerHTML = '<div style="color: #7f8c8d; font-size: 12px; text-align: center;">アカウント未登録です。</div>';
        return;
    }
    
    get(ref(db, `users/${myUserId}/friends`)).then((snapshot) => {
        const friends = snapshot.val();
        if (!friends) {
            listEl.innerHTML = '<div style="color: #7f8c8d; font-size: 12px; text-align: center;">フレンドがまだいません。</div>';
            return;
        }
        
        listEl.innerHTML = "";
        const friendIds = Object.keys(friends);
        
        friendIds.forEach(friendId => {
            get(ref(db, `users/${friendId}`)).then((fSnap) => {
                const friendProfile = fSnap.val();
                if (friendProfile) {
                    const isOnline = friendProfile.status !== "offline" && (Date.now() - friendProfile.lastActive < 45000);
                    
                    const item = document.createElement('div');
                    item.style.display = "flex";
                    item.style.justifyContent = "space-between";
                    item.style.alignItems = "center";
                    item.style.padding = "8px 12px";
                    item.style.background = "white";
                    item.style.border = "1px solid #d3c9b8";
                    item.style.borderRadius = "8px";
                    item.style.fontSize = "13px";
                    
                    const nameSpan = document.createElement('span');
                    nameSpan.innerText = friendProfile.name;
                    nameSpan.style.fontWeight = "bold";
                    nameSpan.style.color = "#4a3b32";
                    
                    const inviteBtn = document.createElement('button');
                    inviteBtn.innerText = isOnline ? "招待" : "オフライン";
                    inviteBtn.disabled = !isOnline;
                    inviteBtn.style.padding = "4px 10px";
                    inviteBtn.style.fontSize = "11px";
                    inviteBtn.style.borderRadius = "12px";
                    inviteBtn.style.backgroundColor = isOnline ? "#2ecc71" : "#bdc3c7";
                    inviteBtn.style.borderBottom = isOnline ? "3px solid #27ae60" : "none";
                    inviteBtn.style.color = "white";
                    
                    inviteBtn.onclick = () => {
                        inviteBtn.innerText = "送信済";
                        inviteBtn.disabled = true;
                        inviteBtn.style.backgroundColor = "#7f8c8d";
                        inviteBtn.style.borderBottom = "none";
                        
                        const inviteRef = push(ref(db, `users/${friendId}/invites`));
                        set(inviteRef, {
                            fromName: myPlayerName,
                            roomId: roomId,
                            gameType: "quiz",
                            timestamp: Date.now()
                        });
                    };
                    
                    item.appendChild(nameSpan);
                    item.appendChild(inviteBtn);
                    listEl.appendChild(item);
                }
            });
        });
    });
}
