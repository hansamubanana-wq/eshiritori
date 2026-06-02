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

let roomId = "";
let myPlayerName = "";
let myPlayerId = "";
let isHost = false;
let roomState = null;
let sendCanvasTimeout = null;

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

window.connectLobby = function() {
    myPlayerName = document.getElementById('user-name').value.trim();
    roomId = document.getElementById('room-id').value.trim();
    if(!myPlayerName || !roomId) {
        alert("なまえ と パスワード をいれてね！");
        return;
    }
    myPlayerId = "p_" + Math.random().toString(36).substring(2, 10);
    
    const roomRef = ref(db, 'rooms/' + roomId);
    get(roomRef).then((snapshot) => {
        // 💡 過去のゲームデータが残っているかチェック
        if (snapshot.exists()) {
            let data = snapshot.val();
            // 終わっている、またはプレイ中の古い部屋なら、最初の人が自動的にリセットして再利用
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
    const roomRef = ref(db, 'rooms/' + roomId);
    const startChar = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろ"[Math.floor(Math.random() * 42)];
    let endChar = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろ"[Math.floor(Math.random() * 42)];
    while(startChar === endChar) {
        endChar = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろ"[Math.floor(Math.random() * 42)];
    }

    const initialData = {
        status: "waiting",
        currentIndex: 0,
        startChar: startChar,
        endChar: endChar,
        playersOrder: [myPlayerId],
        players: {
            [myPlayerId]: { name: myPlayerName, isHost: true }
        },
        gameData: [],
        canvasData: ""
    };

    set(roomRef, initialData).then(() => {
        listenToRoom();
        changeScreen('screen-lobby');
    });
}

function joinRoom() {
    const playersRef = ref(db, `rooms/${roomId}/players/${myPlayerId}`);
    set(playersRef, { name: myPlayerName, isHost: false }).then(() => {
        const roomRef = ref(db, 'rooms/' + roomId);
        get(roomRef).then((snapshot) => {
            let data = snapshot.val();
            let order = data.playersOrder || [];
            if (!order.includes(myPlayerId)) {
                order.push(myPlayerId);
            }
            update(ref(db, 'rooms/' + roomId), { playersOrder: order });
        });
        
        listenToRoom();
        changeScreen('screen-lobby');
    });
}

function listenToRoom() {
    const roomRef = ref(db, 'rooms/' + roomId);
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
            document.getElementById('global-roadmap-box').style.display = 'block';
            syncGameFlow();
        }

        if (data.status === "result") {
            showResultView();
        }
    });
}

window.hostStartGame = function() {
    if(!isHost) return;
    update(ref(db, 'rooms/' + roomId), { status: "playing", currentIndex: 0 });
}

function syncGameFlow() {
    const order = roomState.playersOrder;
    const curIdx = roomState.currentIndex;
    
    if (curIdx >= order.length * 4) {
        if(isHost) {
            update(ref(db, 'rooms/' + roomId), { status: "result" });
        }
        return;
    }

    drawRoadmap();

    const currentTurnPlayerId = order[curIdx % order.length];
    const currentTurnPlayerName = roomState.players[currentTurnPlayerId].name;

    if (currentTurnPlayerId === myPlayerId) {
        if (document.getElementById('screen-draw').classList.contains('active') || document.getElementById('screen-answer').classList.contains('active')) {
            // 入力画面中は維持
        } else {
            changeScreen('screen-turn');
            document.getElementById('turn-message').innerText = `あなたの番です！`;
        }
    } else {
        changeScreen('screen-wait-turn');
        document.getElementById('wait-message').innerText = `いまは ${currentTurnPlayerName} さんが描いています...`;
        
        const liveImg = document.getElementById('live-stream-view');
        if (roomState.canvasData) {
            liveImg.src = roomState.canvasData;
            liveImg.style.display = 'block';
        } else {
            liveImg.style.display = 'none';
        }
    }
}

function drawRoadmap() {
    const curIdx = roomState.currentIndex;
    const order = roomState.playersOrder;
    const currentRound = Math.floor(curIdx / order.length) + 1;
    
    document.getElementById('round-title').innerText = `【 ${currentRound} / 4 周目 】お題：『${roomState.startChar}』➔『${roomState.endChar}』`;

    const listEl = document.getElementById('roadmap-list');
    listEl.innerHTML = '';

    const startNode = document.createElement('div');
    startNode.className = 'roadmap-endpoint';
    startNode.innerText = roomState.startChar;
    listEl.appendChild(startNode);

    const totalTurns = order.length * 4;
    const gameDataList = roomState.gameData || [];

    for (let i = 0; i < totalTurns; i++) {
        const arrow = document.createElement('div');
        arrow.className = 'roadmap-arrow';
        arrow.innerText = '➔';
        listEl.appendChild(arrow);

        const node = document.createElement('div');
        node.className = 'roadmap-node';
        const pId = order[i % order.length];
        const pName = roomState.players[pId] ? roomState.players[pId].name : "ゲスト";

        if (i < curIdx && gameDataList[i]) {
            node.innerHTML = `
                <div class="node-pname">${pName}</div>
                <img class="node-img" src="${gameDataList[i].image}">
                <div class="node-chars">${gameDataList[i].answer.length}文字</div>
            `;
            attachPreviewEvents(node, i);
        } else if (i === curIdx) {
            node.classList.add('active-now');
            let miniLiveSrc = roomState.canvasData || 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><text x="30" y="50" font-size="24">✍</text></svg>');
            node.innerHTML = `
                <div class="node-pname" style="color:#e67e22;">★ ${pName}</div>
                <img class="node-img" src="${miniLiveSrc}" style="border-color:#e67e22;">
                <div class="node-chars" style="color:#e67e22; font-weight:bold;">生中継中!</div>
            `;
        } else {
            node.classList.add('blank');
            node.innerHTML = `
                <div class="node-pname" style="color:#888;">${pName}</div>
                <div style="font-size:20px; margin:20px 0;">？</div>
                <div class="node-chars">ーー</div>
            `;
        }
        listEl.appendChild(node);
    }

    const endArrow = document.createElement('div');
    endArrow.className = 'roadmap-arrow';
    endArrow.innerText = '➔';
    listEl.appendChild(endArrow);

    const endNode = document.createElement('div');
    endNode.className = 'roadmap-endpoint';
    endNode.style.backgroundColor = '#27ae60';
    endNode.innerText = roomState.endChar;
    listEl.appendChild(endNode);
}

function attachPreviewEvents(element, index) {
    const overlay = document.getElementById('preview-overlay');
    const previewImg = document.getElementById('preview-img');
    const previewName = document.getElementById('preview-name');
    const gameDataList = roomState.gameData || [];

    function showPreview(e) {
        e.preventDefault();
        const data = gameDataList[index];
        if (data) {
            previewImg.src = data.image;
            previewName.innerText = `${index + 1}番手: ${data.player} の絵 (${data.answer.length}文字)`;
            overlay.style.display = 'flex';
        }
    }
    function hidePreview() { overlay.style.display = 'none'; }

    element.addEventListener('mousedown', showPreview);
    window.addEventListener('mouseup', hidePreview);
    element.addEventListener('touchstart', showPreview, {passive: false});
    window.addEventListener('touchend', hidePreview);
}

window.startDrawing = function() {
    changeScreen('screen-draw');
    document.getElementById('drawer-name').innerText = `あなたの番！キャンバスに描いてね！`;
    
    isEraserMode = false;
    currentColor = '#4a3b32';
    currentLineWidth = 4;
    document.getElementById('eraser-btn').classList.remove('selected');
    document.querySelectorAll('.color-dot').forEach(dot => dot.classList.remove('selected'));
    document.querySelector('.color-dot').classList.add('selected');
    document.getElementById('line-width-select').value = "4";

    clearCanvas();
    setupCanvasEvents();
}

window.clearCanvas = function() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    syncCanvasToFirebase();
}

window.finishDrawing = function() {
    changeScreen('screen-answer');
    document.getElementById('correct-answer').value = '';
}

function syncCanvasToFirebase() {
    if (sendCanvasTimeout) clearTimeout(sendCanvasTimeout);
    
    sendCanvasTimeout = setTimeout(() => {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.4);
        update(ref(db, 'rooms/' + roomId), { canvasData: dataUrl });
    }, 30);
}

window.submitAnswer = function() {
    const answerInput = document.getElementById('correct-answer').value.trim();
    if (!answerInput) {
        alert('正解ワードをいれてね！');
        return;
    }

    const imageData = canvas.toDataURL();
    const gameDataList = roomState.gameData || [];
    
    gameDataList.push({
        player: myPlayerName,
        image: imageData,
        answer: answerInput
    });

    const nextIdx = roomState.currentIndex + 1;
    update(ref(db, 'rooms/' + roomId), {
        gameData: gameDataList,
        currentIndex: nextIdx,
        canvasData: ""
    });
}

function showResultView() {
    changeScreen('screen-result');
    drawRoadmap();

    const gameDataList = roomState.gameData || [];
    let correctCount = 0;
    const maxScore = gameDataList.length + 1;
    
    if(gameDataList.length === 0) return;

    const firstHira = kataToHira(gameDataList[0].answer);
    if (firstHira.length > 0 && firstHira.charAt(0) === roomState.startChar) correctCount++;
    
    for (let i = 0; i < gameDataList.length - 1; i++) {
        const currentHira = kataToHira(gameDataList[i].answer);
        const nextHira = kataToHira(gameDataList[i+1].answer);
        if (currentHira.length > 0 && nextHira.length > 0) {
            let lastChar = currentHira.slice(-1);
            if (lastChar === 'ー' && currentHira.length > 1) lastChar = currentHira.slice(-2, -1);
            if (lastChar === nextHira.charAt(0) && lastChar !== 'ん') correctCount++;
        }
    }
    
    const lastHira = kataToHira(gameDataList[gameDataList.length - 1].answer);
    if (lastHira.length > 0) {
        let finalChar = lastHira.slice(-1);
        if (finalChar === 'ー' && lastHira.length > 1) finalChar = lastHira.slice(-2, -1);
        if (finalChar === roomState.endChar) correctCount++;
    }
    
    const successRate = Math.round((correctCount / maxScore) * 100);
    document.getElementById('stats-area').innerHTML = `
        <div class="badge">しりとり結果</div><br>
        <span style="font-size: 24px; color:#d35400;">正答率: ${successRate}%</span><br>
        (${maxScore}箇所中 ${correctCount}箇所成功!)
    `;

    const gridList = document.getElementById('result-grid-list');
    gridList.innerHTML = '';
    gameDataList.forEach((data, index) => {
        const card = document.createElement('div');
        card.className = 'result-card';
        
        let mark = "✅ 成功";
        const currentHira = kataToHira(data.answer);
        
        if (index === 0 && currentHira.charAt(0) !== roomState.startChar) mark = "❌ スタート失敗";
        if (index > 0) {
            const prevHira = kataToHira(gameDataList[index-1].answer);
            let prevLast = prevHira.slice(-1);
            if (prevLast === 'ー' && prevHira.length > 1) prevLast = prevHira.slice(-2, -1);
            if (prevLast !== currentHira.charAt(0)) mark = "❌ 不成立";
        }
        
        let finalChar = currentHira.slice(-1);
        if (finalChar === 'ー' && currentHira.length > 1) finalChar = currentHira.slice(-2, -1);
        if (index === gameDataList.length - 1 && finalChar !== roomState.endChar) mark += " & ❌ ゴール失敗";

        card.innerHTML = `
            <div style="font-size: 12px; color: #7f8c8d;">${index + 1}番手: ${data.player}</div>
            <div style="font-weight: bold; font-size: 16px; margin: 4px 0;">${data.answer}</div>
            <div style="font-size: 11px; color: #e67e22;">${mark}</div>
            <img src="${data.image}">
        `;
        gridList.appendChild(card);
    });

    document.getElementById('next-round-btn').style.display = isHost ? 'inline-block' : 'none';
}

window.nextRound = function() {
    if(!isHost) return;
    const startChar = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろ"[Math.floor(Math.random() * 42)];
    let endChar = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろ"[Math.floor(Math.random() * 42)];
    while(startChar === endChar) {
        endChar = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろ"[Math.floor(Math.random() * 42)];
    }
    let shuffledOrder = [...roomState.playersOrder].sort(() => Math.random() - 0.5);

    update(ref(db, 'rooms/' + roomId), {
        status: "playing",
        currentIndex: 0,
        gameData: [],
        startChar: startChar,
        endChar: endChar,
        playersOrder: shuffledOrder,
        canvasData: ""
    });
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
        
        syncCanvasToFirebase();
    };
    canvas.onmouseup = canvas.onmouseleave = canvas.ontouchend = function() { 
        if (isDrawing) {
            isDrawing = false; 
            syncCanvasToFirebase();
        }
    };
}

function kataToHira(str) {
    return str.replace(/[\u30a1-\u30f6]/g, match => String.fromCharCode(match.charCodeAt(0) - 0x60));
}
