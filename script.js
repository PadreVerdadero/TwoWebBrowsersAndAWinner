// Firebase v9 modular imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  push,
  onValue,
  update,
  remove,
  get,
  child
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-database.js";

/* ---------------------------
   Firebase config (include databaseURL)
   --------------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyB7fXtog_41paX_ucqFadY4_qaDkBOFdP8",
  authDomain: "twowebbrowsers.firebaseapp.com",
  projectId: "twowebbrowsers",
  storageBucket: "twowebbrowsers.firebasestorage.app",
  messagingSenderId: "187940323050",
  appId: "1:187940323050:web:be4be5d2dd748664692193",
  databaseURL: "https://twowebbrowsers-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

/* ---------------------------
   State & DOM refs
   --------------------------- */
let playerName = null;
let currentRoom = "roomA";
let privateRevealsForMe = {}; // cache of reveals given to me: { sourceName: {role, revealedAt} }
let roundTimerInterval = null; // if this client is the authoritative timer writer

const joinBtn = document.getElementById("joinBtn");
const renameBtn = document.getElementById("renameBtn");
const playerNameInput = document.getElementById("playerNameInput");
const messagesEl = document.getElementById("messages");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const startRoundBtn = document.getElementById("startRoundBtn");
const stopRoundBtn = document.getElementById("stopRoundBtn");
const exchangeBtn = document.getElementById("exchangeBtn");
const leaderAEl = document.getElementById("leaderA");
const leaderBEl = document.getElementById("leaderB");
const timerEl = document.getElementById("timer");
const phaseEl = document.getElementById("phase");

const actionMenu = document.getElementById("actionMenu");
const actionMenuTitle = document.getElementById("actionMenuTitle");
const menuToggleLeader = document.getElementById("menuToggleLeader");
const menuPrivateMsg = document.getElementById("menuPrivateMsg");
const menuRevealColor = document.getElementById("menuRevealColor");
const menuRevealRole = document.getElementById("menuRevealRole");
const menuMarkHostage = document.getElementById("menuMarkHostage");
const menuClose = document.getElementById("menuClose");

const modalOverlay = document.getElementById("modalOverlay");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const modalCancel = document.getElementById("modalCancel");
const modalConfirm = document.getElementById("modalConfirm");

/* ---------------------------
   Join / rename
   --------------------------- */
joinBtn.onclick = async () => {
  const name = (playerNameInput.value || "").trim() || "Player" + Math.floor(Math.random() * 1000);
  playerName = name;
  await set(ref(db, `rooms/${currentRoom}/players/${playerName}`), {
    role: "Unknown",
    revealed: false
  });
  // store a small meta node so we can enforce client-only name changes later if desired
  await set(ref(db, `playersMeta/${playerName}`), { joinedAt: Date.now() });

  document.getElementById("nameSelect").style.display = "none";
  renameBtn.style.display = "inline-block";

  // Render UI and listeners
  renderRoom("roomA", "playersA");
  renderRoom("roomB", "playersB");
  renderLeaderLabels();
  attachInboxListener(playerName);
  attachPrivateRevealsListener(playerName);
  attachRoundListener(); // listen to DB authoritative round state
};

renameBtn.onclick = async () => {
  const newName = prompt("Enter new name:");
  if (!newName) return;
  // Remove old node and create new node under current room
  await remove(ref(db, `rooms/${currentRoom}/players/${playerName}`));
  await remove(ref(db, `playersMeta/${playerName}`));
  playerName = newName.trim();
  await set(ref(db, `rooms/${currentRoom}/players/${playerName}`), { role: "Unknown", revealed: false });
  await set(ref(db, `playersMeta/${playerName}`), { joinedAt: Date.now() });
  attachInboxListener(playerName);
  attachPrivateRevealsListener(playerName);
};

/* ---------------------------
   Room chat: send message to each player in the room's inbox
   --------------------------- */
sendBtn.onclick = sendRoomMessage;
chatInput.addEventListener("keypress", e => { if (e.key === "Enter") sendRoomMessage(); });

async function sendRoomMessage() {
  const text = chatInput.value.trim();
  if (!text || !playerName) return;
  const playersSnap = await get(child(ref(db), `rooms/${currentRoom}/players`));
  const players = playersSnap.exists() ? playersSnap.val() : {};
  const ts = Date.now();

  const promises = Object.keys(players).map(target => {
    const msgRef = push(ref(db, `inboxes/${target}/messages`));
    return set(msgRef, {
      from: playerName,
      text,
      ts,
      roomMessage: true,
      room: currentRoom
    });
  });

  await Promise.all(promises);
  chatInput.value = "";
}

/* ---------------------------
   Private message helper (to a single target)
   --------------------------- */
async function sendPrivateMessage(target, text) {
  if (!playerName || !target || !text) return;
  const msgRef = push(ref(db, `inboxes/${target}/messages`));
  await set(msgRef, {
    from: playerName,
    text,
    ts: Date.now(),
    roomMessage: false
  });
}

/* ---------------------------
   Private reveal helper (reveal to a single target)
   stored at privateReveals/{target}/{source}
   --------------------------- */
async function revealToTarget(target, revealPayload) {
  if (!playerName || !target) return;
  await set(ref(db, `privateReveals/${target}/${playerName}`), {
    ...revealPayload,
    revealedAt: Date.now()
  });
}

/* ---------------------------
   Render room players (contextual menu)
   --------------------------- */
function renderRoom(roomId, containerId) {
  const playersRef = ref(db, `rooms/${roomId}/players`);
  const leaderRef = ref(db, `rooms/${roomId}/leader`);
  onValue(playersRef, async snapshot => {
    const players = snapshot.val() || {};
    const container = document.getElementById(containerId);
    container.innerHTML = "";

    const leaderSnap = await get(leaderRef);
    const leaderName = leaderSnap.exists() ? leaderSnap.val() : null;

    for (const name of Object.keys(players)) {
      const info = players[name];
      const div = document.createElement("div");
      div.className = "player";

      if (leaderName === name) div.classList.add("leader");

      // Display only private reveals for me
      let displayText = name;
      let emoji = "";
      const privateReveal = privateRevealsForMe[name];
      if (privateReveal && privateReveal.role) {
        const r = privateReveal.role;
        if (r === "Red") { div.classList.add("red"); emoji = "🔴"; }
        else if (r === "Blue") { div.classList.add("blue"); emoji = "🔵"; }
        else if (r === "President") emoji = "👑";
        else if (r === "Bomber") emoji = "💣";
        displayText = `${name} ${emoji}`;
      } else {
        displayText = name;
      }

      div.textContent = displayText;

      // Click handler: show contextual action menu
      div.onclick = (e) => {
        e.stopPropagation();
        showActionMenuFor(name, e.clientX, e.clientY, roomId);
      };

      container.appendChild(div);
    }
  });
}

/* ---------------------------
   Contextual action menu logic
   --------------------------- */
let actionTarget = null;
function showActionMenuFor(targetName, x, y, roomId) {
  actionTarget = { name: targetName, roomId };
  actionMenuTitle.textContent = `Actions for ${targetName}`;
  actionMenu.style.left = `${x}px`;
  actionMenu.style.top = `${y}px`;
  actionMenu.style.display = "block";
}

menuClose.onclick = () => { actionMenu.style.display = "none"; actionTarget = null; };

menuToggleLeader.onclick = async () => {
  if (!actionTarget) return;
  const leaderRef = ref(db, `rooms/${actionTarget.roomId}/leader`);
  const snap = await get(leaderRef);
  const currentLeader = snap.exists() ? snap.val() : null;
  if (currentLeader === actionTarget.name) await set(leaderRef, null);
  else await set(leaderRef, actionTarget.name);
  actionMenu.style.display = "none";
};

menuPrivateMsg.onclick = () => {
  if (!actionTarget) return;
  openModal(`Private message to ${actionTarget.name}`, createMessageForm(), async () => {
    const text = document.getElementById("modalInput").value.trim();
    if (text) await sendPrivateMessage(actionTarget.name, text);
  });
  actionMenu.style.display = "none";
};

menuRevealColor.onclick = () => {
  if (!actionTarget) return;
  openModal(`Reveal color to ${actionTarget.name}`, createRevealForm("color"), async () => {
    const color = document.getElementById("modalSelect").value;
    await revealToTarget(actionTarget.name, { role: color });
  });
  actionMenu.style.display = "none";
};

menuRevealRole.onclick = () => {
  if (!actionTarget) return;
  openModal(`Reveal role to ${actionTarget.name}`, createRevealForm("role"), async () => {
    const role = document.getElementById("modalSelect").value;
    await revealToTarget(actionTarget.name, { role });
  });
  actionMenu.style.display = "none";
};

menuMarkHostage.onclick = async () => {
  if (!actionTarget) return;
  const roomId = actionTarget.roomId;
  const currentTargetSnap = await get(ref(db, `rooms/${roomId}/hostageTarget`));
  const currentTarget = currentTargetSnap.exists() ? currentTargetSnap.val() : null;
  if (currentTarget === actionTarget.name) {
    await set(ref(db, `rooms/${roomId}/hostageTarget`), null);
    alert(`${actionTarget.name} unmarked as hostage target.`);
  } else {
    await set(ref(db, `rooms/${roomId}/hostageTarget`), actionTarget.name);
    alert(`${actionTarget.name} marked as hostage target.`);
  }
  actionMenu.style.display = "none";
};

/* ---------------------------
   Modal helpers
   --------------------------- */
function openModal(title, bodyHtml, onConfirm) {
  modalTitle.textContent = title;
  modalBody.innerHTML = "";
  if (typeof bodyHtml === "string") modalBody.innerHTML = bodyHtml;
  else modalBody.appendChild(bodyHtml);
  modalOverlay.style.display = "flex";

  modalCancel.onclick = () => { modalOverlay.style.display = "none"; };
  modalConfirm.onclick = async () => {
    await onConfirm();
    modalOverlay.style.display = "none";
  };
}

function createMessageForm() {
  const wrapper = document.createElement("div");
  const input = document.createElement("textarea");
  input.id = "modalInput";
  input.rows = 4;
  input.placeholder = "Type your private message...";
  wrapper.appendChild(input);
  return wrapper;
}

function createRevealForm(type) {
  const wrapper = document.createElement("div");
  const select = document.createElement("select");
  select.id = "modalSelect";
  if (type === "color") {
    const o1 = document.createElement("option"); o1.value = "Red"; o1.textContent = "Red";
    const o2 = document.createElement("option"); o2.value = "Blue"; o2.textContent = "Blue";
    select.appendChild(o1); select.appendChild(o2);
  } else {
    const o1 = document.createElement("option"); o1.value = "President"; o1.textContent = "President";
    const o2 = document.createElement("option"); o2.value = "Bomber"; o2.textContent = "Bomber";
    select.appendChild(o1); select.appendChild(o2);
  }
  wrapper.appendChild(select);
  return wrapper;
}

/* ---------------------------
   Leader labels
   --------------------------- */
function renderLeaderLabels() {
  onValue(ref(db, "rooms/roomA/leader"), snap => {
    const leader = snap.val();
    leaderAEl.textContent = `Leader: ${leader || "(none)"}`;
  });
  onValue(ref(db, "rooms/roomB/leader"), snap => {
    const leader = snap.val();
    leaderBEl.textContent = `Leader: ${leader || "(none)"}`;
  });
}

/* ---------------------------
   Inbox listener (my personal inbox)
   --------------------------- */
function attachInboxListener(viewerName) {
  if (!viewerName) return;
  const inboxRef = ref(db, `inboxes/${viewerName}/messages`);
  onValue(inboxRef, snapshot => {
    const msgs = snapshot.val() || {};
    const arr = Object.keys(msgs).map(k => ({ id: k, ...msgs[k] }));
    arr.sort((a, b) => (a.ts || 0) - (b.ts || 0));

    messagesEl.innerHTML = "";
    for (const m of arr) {
      const p = document.createElement("p");
      if (m.roomMessage) {
        p.innerHTML = `<strong>[Room ${m.room}] ${m.from}:</strong> ${m.text}`;
      } else {
        p.innerHTML = `<em>Private from ${m.from}:</em> ${m.text}`;
      }
      messagesEl.appendChild(p);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

/* ---------------------------
   Private reveals listener for me
   --------------------------- */
function attachPrivateRevealsListener(viewerName) {
  if (!viewerName) return;
  onValue(ref(db, `privateReveals/${viewerName}`), snap => {
    privateRevealsForMe = snap.val() || {};
    renderRoom("roomA", "playersA");
    renderRoom("roomB", "playersB");
  });
}

/* ---------------------------
   Hostage exchange (leader only)
   --------------------------- */
exchangeBtn.onclick = async () => {
  if (!playerName) return;
  if (!inExchangeWindow) {
    alert("Hostage exchange only allowed during the exchange window (last 20 seconds).");
    return;
  }

  const leaderSnap = await get(ref(db, `rooms/${currentRoom}/leader`));
  const leader = leaderSnap.exists() ? leaderSnap.val() : null;
  if (leader !== playerName) {
    alert("Only the leader can perform the hostage exchange.");
    return;
  }

  const targetSnap = await get(ref(db, `rooms/${currentRoom}/hostageTarget`));
  let target = targetSnap.exists() ? targetSnap.val() : null;
  if (!target) {
    const playersSnap = await get(ref(db, `rooms/${currentRoom}/players`));
    const players = playersSnap.exists() ? Object.keys(playersSnap.val()) : [];
    const choice = prompt(`No hostage target set. Enter player name to move (or leave blank to move yourself):\n${players.join(", ")}`);
    if (choice && players.includes(choice)) target = choice;
    else target = playerName;
  }

  const newRoom = currentRoom === "roomA" ? "roomB" : "roomA";
  const playerInfoSnap = await get(ref(db, `rooms/${currentRoom}/players/${target}`));
  const info = playerInfoSnap.exists() ? playerInfoSnap.val() : { role: "Unknown", revealed: false };

  await set(ref(db, `rooms/${newRoom}/players/${target}`), info);
  await remove(ref(db, `rooms/${currentRoom}/players/${target}`));
  await set(ref(db, `rooms/${currentRoom}/hostageTarget`), null);
  await set(ref(db, `rooms/${currentRoom}/leader`), null);

  if (target === playerName) currentRoom = newRoom;
  alert(`${target} moved to ${newRoom}.`);
};

/* ---------------------------
   DB-authoritative round state
   - stored at /meta/round: { timeLeft, phase, running, startedBy }
   - any client can start; the client that starts becomes the authoritative writer
   --------------------------- */
startRoundBtn.onclick = async () => {
  if (!playerName) { alert("Join first"); return; }
  // Attempt to start round only if not already running
  const roundRef = ref(db, `meta/round`);
  const snap = await get(roundRef);
  const current = snap.exists() ? snap.val() : null;
  if (current && current.running) {
    alert("Round already running.");
    return;
  }
  // Initialize round state and become authoritative writer
  await set(roundRef, { timeLeft: 180, phase: "discussion", running: true, startedBy: playerName });
  startAuthoritativeTimer(roundRef, playerName);
};

stopRoundBtn.onclick = async () => {
  const roundRef = ref(db, `meta/round`);
  await set(roundRef, { timeLeft: 0, phase: "stopped", running: false, startedBy: null });
  // If this client was writing, stop local interval
  if (roundTimerInterval) { clearInterval(roundTimerInterval); roundTimerInterval = null; }
};

/* Listen to round state and update UI */
function attachRoundListener() {
  onValue(ref(db, `meta/round`), snap => {
    const r = snap.val();
    if (!r) {
      timerEl.textContent = "180";
      phaseEl.textContent = "Phase: Discussion";
      inExchangeWindow = false;
      return;
    }
    timerEl.textContent = r.timeLeft ?? 180;
    phaseEl.textContent = `Phase: ${r.phase ?? "Discussion"}`;
    inExchangeWindow = (r.timeLeft <= 20 && r.running);
    // If this client is the authoritative writer, ensure we have an interval running
    if (r.running && r.startedBy === playerName && !roundTimerInterval) {
      startAuthoritativeTimer(ref(db, `meta/round`), playerName);
    }
  });
}

/* If this client starts the round, it becomes the authoritative writer and updates DB every second */
function startAuthoritativeTimer(roundRef, starterName) {
  // Clear any existing interval
  if (roundTimerInterval) clearInterval(roundTimerInterval);
  roundTimerInterval = setInterval(async () => {
    const snap = await get(roundRef);
    const r = snap.exists() ? snap.val() : null;
    if (!r || !r.running) {
      clearInterval(roundTimerInterval);
      roundTimerInterval = null;
      return;
    }
    let timeLeft = (r.timeLeft ?? 180) - 1;
    let phase = "discussion";
    if (timeLeft <= 0) {
      timeLeft = 180;
      phase = "discussion";
      // stop running for a fresh start (or you can auto-loop)
      await set(roundRef, { timeLeft, phase, running: false, startedBy: null });
      clearInterval(roundTimerInterval);
      roundTimerInterval = null;
      return;
    } else if (timeLeft <= 20) {
      phase = "exchange";
    } else {
      phase = "discussion";
    }
    await set(roundRef, { timeLeft, phase, running: true, startedBy: starterName });
  }, 1000);
}

/* ---------------------------
   Listen for round state on load
   --------------------------- */
attachRoundListener();

/* ---------------------------
   When a player joins, attach inbox and reveals listeners
   --------------------------- */
function attachInboxListenerAndReveals(viewerName) {
  attachInboxListener(viewerName);
  attachPrivateRevealsListener(viewerName);
}

/* ---------------------------
   Utility: safe get
   --------------------------- */
async function safeGet(path) {
  const snap = await get(ref(db, path));
  return snap.exists() ? snap.val() : null;
}

/* ---------------------------
   Start rendering when page loads (rooms will update when players join)
   --------------------------- */
renderRoom("roomA", "playersA");
renderRoom("roomB", "playersB");
renderLeaderLabels();
