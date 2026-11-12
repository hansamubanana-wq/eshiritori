import { getDatabase, ref, set, onValue, update, get, remove, onDisconnect, ready, onReady, sendInvite, addFriend } from "./sync.js";

const account = await ready;
const db = getDatabase();

let myUserId = account.uid;
let myUserName = (await get(ref(db, `users/${myUserId}`))).val()?.name || "";
let myFriendCode = account.friendCode;
let activeListeners = {}; // フレンド状態監視用のリスナー管理

onReady(() => {
    initAccount();

    document.getElementById('register-profile-btn').addEventListener('click', registerProfile);
    document.getElementById('edit-profile-btn').addEventListener('click', editProfileName);
    document.getElementById('add-friend-btn').addEventListener('click', addFriendByCode);
    document.getElementById('display-friendcode-badge').addEventListener('click', copyFriendCode);
});

// アカウントの初期化
function initAccount() {
    if (myUserId && myUserName && myFriendCode) {
        showProfileDisplay();
        updatePresence();
        listenToFriends();
        listenToInvites();
    } else {
        showProfileSetup();
    }
}

function showProfileSetup() {
    document.getElementById('profile-setup-view').style.display = 'block';
    document.getElementById('profile-display-view').style.display = 'none';
    document.getElementById('friends-area').style.display = 'none';
}

function showProfileDisplay() {
    document.getElementById('profile-setup-view').style.display = 'none';
    document.getElementById('profile-display-view').style.display = 'block';
    document.getElementById('friends-area').style.display = 'block';
    document.getElementById('display-username').innerText = myUserName;
    document.getElementById('display-friendcode').innerText = myFriendCode;
}

// プロフィール登録
async function registerProfile() {
    const name = document.getElementById('profile-name-input').value.trim();
    if (!name) { alert("名前を入力してください！"); return; }
    await update(ref(db, `users/${myUserId}`), { name, status: "online", lastActive: Date.now() });
    myUserName = name;
    localStorage.setItem('username', name);
    initAccount();
}

// 名前変更
function editProfileName() {
    const newName = prompt("新しい名前を入力してください：", myUserName);
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed) {
        alert("名前を入力してください！");
        return;
    }

    myUserName = trimmed;
    localStorage.setItem('username', myUserName);
    document.getElementById('display-username').innerText = myUserName;

    // サーバー更新
    update(ref(db, `users/${myUserId}`), { name: myUserName });
}

// フレンドコードのコピー
function copyFriendCode() {
    navigator.clipboard.writeText(myFriendCode).then(() => {
        alert("フレンドコードをクリップボードにコピーしました！");
    }).catch(err => {
        console.error("コピー失敗: ", err);
    });
}

// リアルタイムオンライン状況の同期
function updatePresence() {
    const userStatusRef = ref(db, `users/${myUserId}/status`);
    const userActiveRef = ref(db, `users/${myUserId}/lastActive`);

    // タブが閉じられたらオフラインにする
    onDisconnect(userStatusRef).set("offline");

    // 定期的にステータスをオンラインに更新
    setInterval(() => {
        if (myUserId) {
            set(userStatusRef, "online");
            set(userActiveRef, Date.now());
        }
    }, 20000);

    // 初回起動時
    set(userStatusRef, "online");
    set(userActiveRef, Date.now());
}

// フレンド追加（片方が入力したら両方登録される相互自動方式に変更）
async function addFriendByCode() {
    const input = document.getElementById('friend-code-input');
    const code = input.value.trim().toUpperCase();
    if (!code) { alert("フレンドコードを入力してください！"); return; }
    try {
        await addFriend(code);
        input.value = "";
        alert("フレンドを追加しました！お互いのリストに同期されたよ。");
    } catch { alert("フレンドコードを確認してください。"); }
}

// フレンドのリアルタイム監視
function listenToFriends() {
    const friendsRef = ref(db, `users/${myUserId}/friends`);
    onValue(friendsRef, (snapshot) => {
        const friends = snapshot.val();
        const listEl = document.getElementById('friends-list');
        listEl.querySelectorAll('[data-empty]').forEach(el => el.remove());

        if (!friends) {
            listEl.innerHTML = '<div data-empty style="color: #7f6e64; font-size: 12px; text-align: center; padding: 20px 0;">フレンドがまだいません</div>';
            // 古いリスナーを解放
            Object.keys(activeListeners).forEach(id => {
                activeListeners[id]();
            });
            activeListeners = {};
            return;
        }

        const friendIds = Object.keys(friends);
        
        friendIds.forEach(friendId => {
            if (!activeListeners[friendId]) {
                const friendProfileRef = ref(db, `users/${friendId}`);
                // 各フレンドのプロフィールのリアルタイム監視
                const unsub = onValue(friendProfileRef, (pSnapshot) => {
                    const fProfile = pSnapshot.val();
                    renderFriendItem(friendId, fProfile);
                });
                activeListeners[friendId] = unsub;
            }
        });

        // 削除されたフレンドのリスナーを解除
        Object.keys(activeListeners).forEach(id => {
            if (!friends[id]) {
                activeListeners[id]();
                delete activeListeners[id];
                document.getElementById(`friend-row-${id}`)?.remove();
            }
        });
    });
}

// フレンド一覧表示レンダリング
function renderFriendItem(friendId, profile) {
    if (!profile) return;
    
    // すでに表示されていれば更新、なければ新規作成
    let rowEl = document.getElementById(`friend-row-${friendId}`);
    if (!rowEl) {
        rowEl = document.createElement('div');
        rowEl.id = `friend-row-${friendId}`;
        rowEl.className = "friend-item";
        document.getElementById('friends-list').appendChild(rowEl);
    }

    const isOnline = profile.status !== "offline" && (Date.now() - profile.lastActive < 45000);
    const isPlaying = isOnline && profile.status.startsWith("playing_");
    
    let statusClass = "offline";
    let statusText = "🔴 オフライン";
    if (isPlaying) {
        statusClass = "playing";
        const gameNames = {
            playing_shiritori: "しりとり中",
            playing_quiz: "クイズ中",
            playing_telephone: "伝言ゲーム中",
            playing_wordwolf: "ワードウルフ中",
            playing_typing: "タイピング中",
            playing_quizbattle: "クイズバトル中",
            playing_memory: "神経衰弱中",
        };
        const gameName = gameNames[profile.status] || "プレイ中";
        statusText = `🎮 ${gameName}`;
    } else if (isOnline) {
        statusClass = "online";
        statusText = "🟢 オンライン";
    }

    rowEl.innerHTML = `
        <span style="color: #4a3b32; font-weight: bold;">${profile.name}</span>
        <div class="friend-status">
            <span class="status-dot ${statusClass}"></span>
            <span style="font-size: 11px; color: #7f6e64;">${statusText}</span>
        </div>
    `;
}

// リアルタイムゲーム招待の受信監視
function listenToInvites() {
    const invitesRef = ref(db, `users/${myUserId}/invites`);
    onValue(invitesRef, (snapshot) => {
        const invites = snapshot.val();
        if (!invites) return;

        // 最新の招待を取得
        const inviteKeys = Object.keys(invites);
        if (inviteKeys.length === 0) return;
        
        const latestKey = inviteKeys[inviteKeys.length - 1];
        const invite = invites[latestKey];

        // 1分以上前の古い招待は無視
        if (Date.now() - invite.timestamp > 60000) {
            remove(ref(db, `users/${myUserId}/invites/${latestKey}`));
            return;
        }

        // モーダルを表示
        const modal = document.getElementById('invite-modal');
        const modalText = document.getElementById('invite-modal-text');
        
        let gameTitle = "ゲーム";
        let redirectUrl = "";
        const gameMap = {
            eshiritori:  { title: "リアルタイム絵しりとり",   url: "eshiritori/index.html" },
            quiz:        { title: "スピードお絵描きクイズ",   url: "drawing-quiz/index.html" },
            telephone:   { title: "お絵描き伝言ゲーム",       url: "drawing-telephone/index.html" },
            wordwolf:    { title: "ワードウルフ",             url: "word-wolf/index.html" },
            typing:      { title: "タイピングレース",         url: "typing-race/index.html" },
            quizbattle:  { title: "クイズバトル",             url: "quiz-battle/index.html" },
            memory:      { title: "神経衰弱",                 url: "memory-cards/index.html" },
        };
        if (gameMap[invite.gameType]) {
            gameTitle = gameMap[invite.gameType].title;
            redirectUrl = gameMap[invite.gameType].url;
        }

        modalText.innerText = `${invite.fromName} さんから\n『${gameTitle}』\nに招待されました！\n(部屋パスワード: ${invite.roomId})`;
        modal.style.display = "flex";

        // ボタンのハンドラ登録
        document.getElementById('invite-accept-btn').onclick = () => {
            modal.style.display = "none";
            // 招待データを消去して移動
            remove(ref(db, `users/${myUserId}/invites/${latestKey}`)).then(() => {
                window.location.href = `${redirectUrl}?room=${invite.roomId}`;
            });
        };

        document.getElementById('invite-decline-btn').onclick = () => {
            modal.style.display = "none";
            // 招待データを消去
            remove(ref(db, `users/${myUserId}/invites/${latestKey}`));
        };
    });
}
