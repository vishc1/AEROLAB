/**
 * Class rooms: a shared leaderboard behind a short code, so a whole class
 * (or a room full of judges) climbs the same board live. Backed by
 * /api/board; degrades to the local board when the endpoint is unavailable.
 */
const ROOM_KEY = 'aerolab-room';
const NAME_KEY = 'aerolab-name';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const POLL_MS = 8000;

const escapeHtml = (value) => {
  const el = document.createElement('span');
  el.textContent = value;
  return el.innerHTML;
};

function randomCode() {
  let code = '';
  for (let i = 0; i < 4; i += 1) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return code;
}

function readStore(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeStore(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

export function createClassroom() {
  const $ = (id) => document.getElementById(id);
  const bar = $('room-bar');
  const joinForm = $('room-join');
  const codeInput = $('room-code');
  const createButton = $('room-create');
  const active = $('room-active');
  const activeCode = $('room-active-code');
  const activeCount = $('room-active-count');
  const leaveButton = $('room-leave');
  const copyButton = $('room-copy');
  const nameInput = $('room-name');
  const status = $('room-status');
  const roomBoard = $('room-board');
  const localBoard = $('leaderboard');
  const workshopNote = $('workshop-note');

  let room = readStore(ROOM_KEY).toUpperCase();
  let entries = [];
  let timer = null;
  let available = true;

  nameInput.value = readStore(NAME_KEY);
  nameInput.addEventListener('change', () => writeStore(NAME_KEY, nameInput.value.trim().slice(0, 32)));

  const setStatus = (text, state = '') => {
    status.textContent = text;
    status.dataset.state = state;
  };

  const renderBoard = () => {
    const inRoom = Boolean(room);
    roomBoard.hidden = !inRoom;
    localBoard.hidden = inRoom;
    joinForm.hidden = inRoom;
    active.hidden = !inRoom;
    if (!inRoom) return;
    activeCode.textContent = room;
    activeCount.textContent = `${entries.length} run${entries.length === 1 ? '' : 's'}`;
    const me = nameInput.value.trim();
    if (!entries.length) {
      roomBoard.innerHTML = `<div class="empty-board"><span>ROOM ${escapeHtml(room)}</span><h3>Nobody has run a test yet.</h3><p>Share the code. Every five-second test in this room lands on this board.</p></div>`;
      return;
    }
    roomBoard.innerHTML =
      '<div class="board-head board-head-room"><span>RANK / STUDENT · DESIGN</span><span>DRAG</span><span>SCORE</span></div>' +
      entries
        .map(
          (e, i) =>
            `<div class="board-row${me && e.name === me ? ' is-me' : ''}"><b>${String(i + 1).padStart(2, '0')}</b><span><strong>${escapeHtml(e.name)}</strong><small>${escapeHtml(e.design)} · ${new Date(e.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</small></span><code>${Number(e.cd).toFixed(3)}</code><em>${Number(e.score).toFixed(0)}</em></div>`,
        )
        .join('');
  };

  const refresh = async () => {
    if (!room) return;
    try {
      const response = await fetch(`/api/board?room=${encodeURIComponent(room)}`, { cache: 'no-store' });
      if (response.status === 503) {
        available = false;
        setStatus('Class rooms are not configured on this deployment.', 'error');
        return;
      }
      if (!response.ok) throw new Error(`board ${response.status}`);
      const data = await response.json();
      entries = Array.isArray(data.entries) ? data.entries : [];
      available = true;
      setStatus(`Live · updates every ${POLL_MS / 1000}s`, 'live');
      renderBoard();
    } catch {
      setStatus('Could not reach the room. Retrying…', 'error');
    }
  };

  const startPolling = () => {
    clearInterval(timer);
    if (!room) return;
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
  };

  const join = (code) => {
    const next = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (next.length < 4) {
      setStatus('A room code is 4 to 8 letters or digits.', 'error');
      return;
    }
    room = next;
    entries = [];
    writeStore(ROOM_KEY, room);
    renderBoard();
    setStatus('Joining…');
    refresh();
    startPolling();
    workshopNote.textContent = `You are in room ${room}. Every test you run is posted to the shared board.`;
  };

  const leave = () => {
    room = '';
    entries = [];
    writeStore(ROOM_KEY, '');
    clearInterval(timer);
    renderBoard();
    setStatus('');
    workshopNote.textContent = 'Scores are kept in this browser. Join a class room to climb the same board as everyone else.';
  };

  joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    join(codeInput.value);
  });
  createButton.addEventListener('click', () => {
    codeInput.value = randomCode();
    join(codeInput.value);
  });
  leaveButton.addEventListener('click', leave);
  copyButton.addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?room=${room}`;
    try {
      await navigator.clipboard.writeText(url);
      copyButton.textContent = 'Invite copied';
    } catch {
      copyButton.textContent = url;
    }
    setTimeout(() => (copyButton.textContent = 'Copy invite'), 2200);
  });

  // ?room=CODE in the URL joins straight away (the invite link).
  const fromUrl = new URLSearchParams(location.search).get('room');
  if (fromUrl) join(fromUrl);
  else if (room) join(room);
  else renderBoard();

  return {
    get room() {
      return room;
    },
    join,
    leave,
    refresh,
    /** Post a finished five-second test to the room, if any. */
    async submit({ design, cd, cl, score }) {
      if (!room || !available) return null;
      const name = nameInput.value.trim().slice(0, 32) || 'Anonymous';
      writeStore(NAME_KEY, name);
      try {
        const response = await fetch('/api/board', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room, name, design, cd, cl, score }),
        });
        if (!response.ok) throw new Error(`board ${response.status}`);
        const data = await response.json();
        entries = Array.isArray(data.entries) ? data.entries : entries;
        renderBoard();
        const rank = entries.findIndex((e) => e.id === data.entry?.id) + 1;
        setStatus(rank ? `Posted · you are #${rank} in ${room}` : `Posted to ${room}`, 'live');
        return data.entry;
      } catch {
        setStatus('Could not post this run to the room.', 'error');
        return null;
      }
    },
  };
}
