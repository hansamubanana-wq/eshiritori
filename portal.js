import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update, get, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

let myUserId = localStorage.getItem('userId') || "";
let myUserName = localStorage.getItem('username') || "";
let myFriendCode = localStorage.getItem('friendCode') || "";
let activeListeners = {}; // フレンド状態監視用のリスナー管理

document.addEventListener('DOMContentLoaded', () => {
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
function registerProfile() {
    const nameInput = document.getElementById('profile-name-input').value.trim();
    if (!nameInput) {
        alert("名前を入力してください！");
        return;
    }

    myUserId = "u_" + Math.random().toString(36).substring(2, 12);
    myUserName = nameInput;
    myFriendCode = "FR-" + Math.random().toString(36).substring(2, 8).toUpperCase();

    // データベースに登録
    const userRef = ref(db, `users/${myUserId}`);
    const codeRef = ref(db, `friend-codes/${myFriendCode}`);

    set(codeRef, myUserId).then(() => {
        set(userRef, {
            name: myUserName,
            friendCode: myFriendCode,
            status: "online",
            lastActive: Date.now()
        }).then(() => {
            localStorage.setItem('userId', myUserId);
            localStorage.setItem('username', myUserName);
            localStorage.setItem('friendCode', myFriendCode);

            initAccount();
        });
    });
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

    // Firebase更新
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

// フレンド追加
function addFriendByCode() {
    const codeInput = document.getElementById('friend-code-input').value.trim().toUpperCase();
    if (!codeInput) {
        alert("フレンドコードを入力してください！");
        return;
    }

    if (codeInput === myFriendCode) {
        alert("自分自身をフレンドに追加することはできません！");
        return;
    }

    document.getElementById('friend-code-input').value = "";

    // コードからIDを検索
    get(ref(db, `friend-codes/${codeInput}`)).then((snapshot) => {
        if (snapshot.exists()) {
            const friendId = snapshot.val();
            
            // フレンドに追加
            set(ref(db, `users/${myUserId}/friends/${friendId}`), true).then(() => {
                alert("フレンドを追加しました！");
            });
        } else {
            alert("フレンドコードが見つかりません。入力内容を確認してください。");
        }
    });
}

// フレンドのリアルタイム監視
function listenToFriends() {
    const friendsRef = ref(db, `users/${myUserId}/friends`);
    onValue(friendsRef, (snapshot) => {
        const friends = snapshot.val();
        const listEl = document.getElementById('friends-list');
        listEl.innerHTML = "";

        if (!friends) {
            listEl.innerHTML = '<div style="color: #7f6e64; font-size: 12px; text-align: center; padding: 20px 0;">フレンドがまだいません</div>';
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
        let gameName = "プレイ中";
        if (profile.status === "playing_shiritori") gameName = "しりとり中";
        else if (profile.status === "playing_quiz") gameName = "クイズ中";
        else if (profile.status === "playing_telephone") gameName = "伝言ゲーム中";
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
        if (invite.gameType === "eshiritori") {
            gameTitle = "リアルタイム絵しりとり";
            redirectUrl = "eshiritori/index.html";
        } else if (invite.gameType === "quiz") {
            gameTitle = "スピードお絵描きクイズ";
            redirectUrl = "drawing-quiz/index.html";
        } else if (invite.gameType === "telephone") {
            gameTitle = "お絵描き伝言ゲーム";
            redirectUrl = "drawing-telephone/index.html";
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
