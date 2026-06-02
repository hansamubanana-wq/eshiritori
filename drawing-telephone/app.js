import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update, get, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

let roomId = "";
let myPlayerName = "";
let myPlayerId = "";
let isHost = false;
let roomState = null;

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
    
    const roomRef = ref(db, 'rooms-telephone/' + roomId);
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
    const roomRef = ref(db, 'rooms-telephone/' + roomId);
    const initialData = {
        status: "waiting",
        currentStep: 0,
        playersOrder: [myPlayerId],
        players: {
            [myPlayerId]: { name: myPlayerName, isHost: true, submitted: false }
        },
        showcaseIndex: 0
    };

    set(roomRef, initialData).then(() => {
        listenToRoom();
        changeScreen('screen-lobby');
    });
}

function joinRoom() {
    const playerRef = ref(db, `rooms-telephone/${roomId}/players/${myPlayerId}`);
    set(playerRef, { name: myPlayerName, isHost: false, submitted: false }).then(() => {
        get(ref(db, 'rooms-telephone/' + roomId)).then((snapshot) => {
            let data = snapshot.val();
            let order = data.playersOrder || [];
            if (!order.includes(myPlayerId)) {
                order.push(myPlayerId);
            }
            update(ref(db, 'rooms-telephone/' + roomId), { playersOrder: order });
        });
        
        listenToRoom();
        changeScreen('screen-lobby');
    });
}

// 部屋の状態監視
function listenToRoom() {
    const roomRef = ref(db, 'rooms-telephone/' + roomId);
    onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
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
            document.getElementById('start-game-btn').style.display = isHost ? 'inline-block' : 'none';
            changeScreen('screen-lobby');
        }
        
        if (data.status === "playing") {
            syncGameFlow();
        }

        if (data.status === "result") {
            showShowcaseView();
        }
    });
}

// ゲームスタート
window.hostStartGame = function() {
    if(!isHost) return;
    
    if (roomState.playersOrder.length < 2) {
        alert("伝言ゲームを遊ぶには2人以上の参加者が必要です！");
        return;
    }

    const updates = {};
    roomState.playersOrder.forEach(pId => {
        updates[`players/${pId}/submitted`] = false;
    });
    updates['status'] = "playing";
    updates['currentStep'] = 0;
    updates['stepData'] = "";
    
    update(ref(db, 'rooms-telephone/' + roomId), updates);
}

// 共通送信処理
function submitTurnData(data) {
    const updates = {};
    updates[`players/${myPlayerId}/submitted`] = true;
    updates[`stepData/step_${roomState.currentStep}/${myPlayerId}`] = data;

    update(ref(db, `rooms-telephone/${roomId}`), updates).then(() => {
        // 全員が送信し終えたかチェック
        get(ref(db, `rooms-telephone/${roomId}`)).then((snapshot) => {
            const freshRoom = snapshot.val();
            let allSubmitted = true;
            freshRoom.playersOrder.forEach(pId => {
                if (!freshRoom.players[pId] || !freshRoom.players[pId].submitted) {
                    allSubmitted = false;
                }
            });

            if (allSubmitted) {
                const nextStep = freshRoom.currentStep + 1;
                const stepUpdates = {};
                freshRoom.playersOrder.forEach(pId => {
                    stepUpdates[`players/${pId}/submitted`] = false;
                });
                
                if (nextStep >= 4) { // お題入力 -> 描く -> 推測 -> 描く の4ステップ終了時
                    stepUpdates['status'] = "result";
                    stepUpdates['showcaseIndex'] = 0;
                } else {
                    stepUpdates['currentStep'] = nextStep;
                }
                update(ref(db, `rooms-telephone/${roomId}`), stepUpdates);
            }
        });
    });
}

// 進行同期
function syncGameFlow() {
    const isSubmitted = roomState.players[myPlayerId].submitted;
    
    if (isSubmitted) {
        showWaitingScreen();
        return;
    }

    const step = roomState.currentStep;
    const order = roomState.playersOrder;
    const N = order.length;
    const myIndex = order.indexOf(myPlayerId);
    
    // 前のプレイヤーのIDを計算
    const prevPlayerId = order[(myIndex - 1 + N) % N];
    const prevPlayerName = roomState.players[prevPlayerId] ? roomState.players[prevPlayerId].name : "ゲスト";

    if (step === 0) {
        // ステップ0：お題を入力する
        changeScreen('screen-step-0');
        document.getElementById('prompt-input').value = "";
    } 
    else if (step === 1) {
        // ステップ1：前の人が書いたお題を絵に描く
        changeScreen('screen-step-1');
        const canvasHolder = document.getElementById('canvas-holder-1');
        if (canvasHolder && canvas) canvasHolder.appendChild(canvas);
        
        const targetPrompt = roomState.stepData.step_0[prevPlayerId];
        document.getElementById('step-1-prompt-display').innerText = `お題：${targetPrompt} (${prevPlayerName}さんより)`;
        
        clearCanvas();
        setupCanvasEvents();
    } 
    else if (step === 2) {
        // ステップ2：前の人が描いた絵が何か推測する
        changeScreen('screen-step-2');
        const targetImage = roomState.stepData.step_1[prevPlayerId];
        document.getElementById('step-2-image-display').src = targetImage;
        document.getElementById('guess-input').value = "";
    } 
    else if (step === 3) {
        // ステップ3：前の人が推測した言葉を絵に描く
        changeScreen('screen-step-3');
        const canvasHolder = document.getElementById('canvas-holder-3');
        if (canvasHolder && canvas) canvasHolder.appendChild(canvas);

        const targetGuess = roomState.stepData.step_2[prevPlayerId];
        document.getElementById('step-3-guess-display').innerText = `お題：${targetGuess} (${prevPlayerName}さんより)`;
        
        clearCanvas();
        setupCanvasEvents();
    }
}

// 提出待ち画面
function showWaitingScreen() {
    changeScreen('screen-waiting');
    
    const indicatorText = document.getElementById('step-indicator-text');
    const step = roomState.currentStep;
    if (step === 0) indicatorText.innerText = "みんながお題を書くのを待っています...";
    else if (step === 1) indicatorText.innerText = "みんながお絵描きするのを待っています...";
    else if (step === 2) indicatorText.innerText = "みんなが絵を推測するのを待っています...";
    else if (step === 3) indicatorText.innerText = "みんなが最後のお絵描きをするのを待っています...";

    // プレイヤーの提出状況リスト作成
    const listEl = document.getElementById('waiting-players-status');
    listEl.innerHTML = "";
    roomState.playersOrder.forEach(pId => {
        const p = roomState.players[pId];
        if (p) {
            const row = document.createElement('div');
            row.className = "status-row";
            row.innerHTML = `
                <span>${p.name}</span>
                <span class="status-badge ${p.submitted ? 'done' : 'pending'}">${p.submitted ? '完了！' : '入力中...'}</span>
            `;
            listEl.appendChild(row);
        }
    });
}

// 提出イベント
window.submitPrompt = function() {
    const promptText = document.getElementById('prompt-input').value.trim();
    if (!promptText) {
        alert("おもしろいお題を入力してね！");
        return;
    }
    submitTurnData(promptText);
}

window.submitDrawing1 = function() {
    const canvasData = canvas.toDataURL();
    submitTurnData(canvasData);
}

window.submitGuess = function() {
    const guessText = document.getElementById('guess-input').value.trim();
    if (!guessText) {
        alert("絵の推測を入力してね！");
        return;
    }
    submitTurnData(guessText);
}

window.submitDrawing3 = function() {
    const canvasData = canvas.toDataURL();
    submitTurnData(canvasData);
}

// 発表会（ショーケース）画面表示
function showShowcaseView() {
    changeScreen('screen-result');
    
    const order = roomState.playersOrder;
    const N = order.length;
    const sIdx = roomState.showcaseIndex || 0;
    
    // 主役プレイヤー
    const hostPlayerId = order[sIdx];
    const hostPlayerName = roomState.players[hostPlayerId].name;
    document.getElementById('showcase-chain-owner').innerText = `【 ${sIdx + 1} / ${N} 】 ${hostPlayerName} さんの伝言歴史`;

    const chainEl = document.getElementById('showcase-chain-list');
    chainEl.innerHTML = "";

    // 1. 最初のお題（主役が書いた）
    const prompt0 = roomState.stepData.step_0[hostPlayerId];
    chainEl.appendChild(createChainTextItem("スタートのお題", hostPlayerName, prompt0));

    // 2. 最初の絵（次の人が描いた）
    const p1 = order[(sIdx + 1) % N];
    const p1Name = roomState.players[p1].name;
    const img1 = roomState.stepData.step_1[p1];
    chainEl.appendChild(createChainImageItem(`${p1Name} さんが描いた絵`, img1));

    // 3. 次の人の推測（さらに次の人が推測）
    const p2 = order[(sIdx + 2) % N];
    const p2Name = roomState.players[p2].name;
    const guess2 = roomState.stepData.step_2[p2];
    chainEl.appendChild(createChainTextItem(`${p2Name} さんの推測`, p2Name, guess2));

    // 4. 最後の絵（さらに次の人が描いた）
    const p3 = order[(sIdx + 3) % N];
    const p3Name = roomState.players[p3].name;
    const img3 = roomState.stepData.step_3[p3];
    chainEl.appendChild(createChainImageItem(`${p3Name} さんが描いた絵`, img3));

    // コントロール表示
    document.getElementById('next-chain-btn').style.display = isHost && sIdx < N - 1 ? 'inline-block' : 'none';
    document.getElementById('restart-game-btn').style.display = isHost && sIdx === N - 1 ? 'inline-block' : 'none';
}

function createChainTextItem(label, author, text) {
    const div = document.createElement('div');
    div.className = "chain-item";
    div.innerHTML = `
        <div class="chain-item-label">${label} (${author})</div>
        <div class="chain-item-text">「 ${text} 」</div>
    `;
    return div;
}

function createChainImageItem(label, imgSrc) {
    const div = document.createElement('div');
    div.className = "chain-item";
    div.innerHTML = `
        <div class="chain-item-label">${label}</div>
        <img class="chain-item-image" src="${imgSrc}">
    `;
    return div;
}

// 主催者操作：次のチェーンへ
window.nextShowcaseChain = function() {
    if (!isHost) return;
    const nextIdx = (roomState.showcaseIndex || 0) + 1;
    update(ref(db, `rooms-telephone/${roomId}`), { showcaseIndex: nextIdx });
}

// 主催者操作：再プレイ
window.restartTelephoneGame = function() {
    if (!isHost) return;
    hostStartGame();
}

// キャンバス描画操作
window.clearCanvas = function() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
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
    canvas.onmousedown = canvas.ontouchstart = function(e) {
        isDrawing = true; const pos = getPos(e); ctx.beginPath(); ctx.moveTo(pos.x, pos.y);
    };
    canvas.onmousemove = canvas.ontouchmove = function(e) {
        if (!isDrawing) return; e.preventDefault(); const pos = getPos(e);
        ctx.lineWidth = currentLineWidth; ctx.lineCap = 'round';
        ctx.strokeStyle = isEraserMode ? '#ffffff' : currentColor;
        ctx.lineTo(pos.x, pos.y); ctx.stroke();
    };
    canvas.onmouseup = canvas.onmouseleave = canvas.ontouchend = function() { 
        if (isDrawing) {
            isDrawing = false; 
        }
    };
}
