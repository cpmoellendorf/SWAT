window.addEventListener('load', function () {

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  function createDiv(className, text) {
    const el = document.createElement('div');
    el.className = className;
    el.innerText = text;
    return el;
  }

  function getCell(x, y) {
    return board.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
  }

  // ==========================================================================
  // CONSTANTS
  // ==========================================================================

  const LETTERS      = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O'];
  const COLUMNS      = 16;
  const ROWS         = 11;
  // Roles assigned to guests in join order. Host is always defense-1.
  const ROLE_SLOTS   = ['attack-1', 'defense-2', 'attack-2'];
  const STUN_CONFIG  = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  const PEER_OPTIONS = { debug: 2, config: STUN_CONFIG };

  // ==========================================================================
  // DOM REFERENCES
  // ==========================================================================

  const board      = document.getElementById('game-board');
  const supplyGrid = document.getElementById('supply-grid');
  const trashBin   = document.getElementById('trash-bin');
  const copyBtn    = document.getElementById('copy-link-btn');
  const statusText = document.getElementById('link-status');
  const guideCard  = document.querySelector('.guide-panel');

  // ==========================================================================
  // MUTABLE STATE
  // ==========================================================================

  let peer              = null;
  let activeConnections = [];
  let myRole            = 'defense-1'; // Host default; guests receive their role via assign-role
  let draggedToken      = null;
  let isSupplyToken     = false;

  // Host-only: maps peerId → assigned role so assignments are deterministic
  // even if two guests connect near-simultaneously.
  const roleRegistry = {};

  // ==========================================================================
  // NETWORK — INITIALIZATION
  // ==========================================================================

  let roomHash = window.location.hash.substring(1);

  if (!roomHash) {
    // Player 1: generate room, become host
    roomHash = Math.random().toString(36).substring(2, 9);
    window.location.hash = roomHash;

    peer = new Peer(roomHash, PEER_OPTIONS);
    peer.on('open', () => {
      statusText.innerText = 'Lobby created! Share this link with Players 2, 3, and 4 (0/3 joined).';
    });

  } else {
    // Players 2–4: join existing room
    peer = new Peer(PEER_OPTIONS);
    peer.on('open', () => {
      statusText.innerText = 'Connecting to lobby...';
      setupConnectionListeners(peer.connect(roomHash));
    });
  }

  // Accept incoming connections from any peer in the mesh
  peer.on('connection', setupConnectionListeners);

  peer.on('error', (err) => {
    console.error('Peer error:', err);
    statusText.innerText = `⚠️ Network error: ${err.type}`;
  });

  // ==========================================================================
  // NETWORK — BROADCAST
  // ==========================================================================

  function sendNetworkData(payload) {
    activeConnections.forEach(conn => {
      if (conn && conn.open) conn.send(payload);
    });
  }

  // ==========================================================================
  // NETWORK — CONNECTION LIFECYCLE
  // ==========================================================================

  function setupConnectionListeners(conn) {

    conn.on('open', () => {
      if (!activeConnections.find(c => c.peer === conn.peer)) {
        activeConnections.push(conn);
      }

      // Only the host assigns roles and syncs the lobby
      if (myRole !== 'defense-1') return;

      // Small delay ensures the data channel is fully open before sending
      setTimeout(() => {

        // Assign a role if this peer doesn't already have one in the registry.
        // Using the registry (not activeConnections.length) makes assignment
        // deterministic even when two guests connect near-simultaneously.
        if (!roleRegistry[conn.peer]) {
          const slotIndex = Object.keys(roleRegistry).length; // 0, 1, 2
          roleRegistry[conn.peer] = ROLE_SLOTS[slotIndex] || 'spectator';
        }
        const assignedRole = roleRegistry[conn.peer];
        conn.send({ type: 'assign-role', role: assignedRole });

        // Introduce this newcomer to all previously connected peers
        const existingPeerIds = activeConnections
          .filter(c => c.peer !== conn.peer)
          .map(c => c.peer);

        if (existingPeerIds.length > 0) {
          conn.send({ type: 'introduce-peers', peerIds: existingPeerIds });
        }

        // Build a complete roster from the registry and broadcast it to everyone.
        // Guests use this authoritative count instead of deriving it from their
        // own partial connection list (which may not be fully formed yet).
        const fullRoster = { [roomHash]: 'defense-1', ...roleRegistry };
        const syncPayload = { type: 'lobby-sync', roster: fullRoster };
        sendNetworkData(syncPayload);
        // Apply locally so the host UI stays current too
        handleLobbySync(syncPayload);

      }, 100);
    });

    conn.on('data', handleIncomingData);

    conn.on('close', () => {
      activeConnections = activeConnections.filter(c => c.peer !== conn.peer);
      // Rebuild and rebroadcast roster so everyone sees the updated count
      if (myRole === 'defense-1') {
        const fullRoster = { [roomHash]: 'defense-1', ...roleRegistry };
        const syncPayload = { type: 'lobby-sync', roster: fullRoster };
        sendNetworkData(syncPayload);
        handleLobbySync(syncPayload);
      } else {
        updateLobbyStatus();
      }
    });
  }

  // ==========================================================================
  // NETWORK — INBOUND DATA HANDLER
  // ==========================================================================

  function handleIncomingData(data) {
    if (!data) return;

    // --- System signals ---
    if (data.type === 'assign-role') {
      myRole = data.role;
      // applyVisualRoleProperties reads myRole, so update it first
      applyVisualRoleProperties(data.role);
      return;
    }

    if (data.type === 'introduce-peers') {
      data.peerIds.forEach(id => {
        if (!activeConnections.find(c => c.peer === id)) {
          setupConnectionListeners(peer.connect(id));
        }
      });
      return;
    }

    if (data.type === 'lobby-sync') {
      handleLobbySync(data);
      return;
    }

    // --- Gameplay packets ---
    const senderTeam = data.senderRole.split('-')[0];
    const myTeam     = myRole.split('-')[0];

    if (senderTeam === myTeam) {
      applyTeamMove(data);
    } else {
      logEnemyIntel(data);
    }
  }

  // ==========================================================================
  // NETWORK — LOBBY SYNC HANDLER
  // ==========================================================================

  // Handles a lobby-sync packet for both host and guests.
  // The roster is the single source of truth for player count and roles,
  // sent by the host every time someone joins or leaves.
  function handleLobbySync(data) {
    const count = Object.keys(data.roster).length;
    statusText.innerText = `🟢 Players: ${count}/4 — You are ${myRole.toUpperCase()}`;
  }

  // Apply a teammate's move to the local board
  function applyTeamMove(data) {
    if (data.isNew) {
      const cell = getCell(data.x, data.y);
      if (!cell) return;
      const token = document.createElement('div');
      token.classList.add('token');
      token.setAttribute('draggable', 'true');
      if (data.color) token.classList.add(data.color);
      bindTokenDragEvents(token, false);
      cell.appendChild(token);
      console.log(`🤝 TEAMMATE placed a token at ${LETTERS[data.x]}${data.y + 1}.`);

    } else if (data.isDelete) {
      const cell = getCell(data.oldX, data.oldY);
      if (!cell) return;
      const token = cell.children[data.tokenIndex];
      if (token) token.remove();
      console.log(`🤝 TEAMMATE deleted a token at ${LETTERS[data.oldX]}${data.oldY + 1}.`);

    } else {
      const sourceCell = getCell(data.oldX, data.oldY);
      const targetCell = getCell(data.x, data.y);
      if (!sourceCell || !targetCell) return;
      const token = sourceCell.children[data.tokenIndex] || sourceCell.querySelector('.token');
      if (token) targetCell.appendChild(token);
      console.log(`🤝 TEAMMATE moved a token to ${LETTERS[data.x]}${data.y + 1}.`);
    }
  }

  // Log enemy activity without revealing position
  function logEnemyIntel(data) {
    const role = data.senderRole.toUpperCase();
    if (data.isNew)         console.log(`📡 ENEMY (${role}) placed a token.`);
    else if (data.isDelete) console.log(`📡 ENEMY (${role}) deleted a token.`);
    else                    console.log(`📡 ENEMY (${role}) moved a token.`);
  }

  // ==========================================================================
  // UI — ROLE VISUALS & LOBBY STATUS
  // ==========================================================================

  function applyVisualRoleProperties(role) {
    if (!guideCard) return;
    const isAttack = role.startsWith('attack');
    guideCard.classList.toggle('attack', isAttack);
    guideCard.querySelector('.guide-header').innerText = isAttack
      ? `ATTACK (${role.toUpperCase()})`
      : `DEFENSE (${role.toUpperCase()})`;
    // myRole is already updated before this call, so status reads the new role correctly
    updateLobbyStatus();
  }

  function updateLobbyStatus() {
    const total = activeConnections.length + 1;
    statusText.innerText = `🟢 Players: ${total}/4 — You are ${myRole.toUpperCase()}`;
  }

  // ==========================================================================
  // DRAG & DROP — TOKEN BINDINGS
  // ==========================================================================

  function bindTokenDragEvents(token, fromSupplyDepot) {
    token.addEventListener('dragstart', (event) => {
      draggedToken  = token;
      isSupplyToken = fromSupplyDepot;
      event.dataTransfer.effectAllowed = 'move';
      setTimeout(() => token.classList.add('dragging'), 1);
    });

    token.addEventListener('dragend', () => {
      token.classList.remove('dragging');
      draggedToken  = null;
      isSupplyToken = false;
    });
  }

  // ==========================================================================
  // DRAG & DROP — CELL EVENTS
  // ==========================================================================

  const WALL_SELECTOR = [
    '[data-wall-right="true"]',
    '[data-wall-bottom="true"]',
    '[data-window-right="true"]',
    '[data-window-bottom="true"]',
  ].join(', ');

  function configureGridCellEvents(cell, gameX, gameY) {
    cell.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = cell.matches(WALL_SELECTOR) ? 'none' : 'move';
    });

    cell.addEventListener('drop', (event) => {
      event.preventDefault();
      if (!draggedToken || cell.matches(WALL_SELECTOR)) return;

      if (isSupplyToken) {
        // Clone from supply and place on board
        const tokenClone = draggedToken.cloneNode(true);
        tokenClone.classList.remove('dragging');
        const colorClass = Array.from(draggedToken.classList)
          .find(c => c !== 'token' && c !== 'dragging') || '';
        bindTokenDragEvents(tokenClone, false);
        cell.appendChild(tokenClone);

        sendNetworkData({ isNew: true, color: colorClass, x: gameX, y: gameY, senderRole: myRole });
        console.log(`You placed a token at ${LETTERS[gameX]}${gameY + 1}.`);

      } else {
        // Move existing token from one cell to another
        const oldX        = parseInt(draggedToken.parentElement.dataset.x);
        const oldY        = parseInt(draggedToken.parentElement.dataset.y);
        const tokenIndex  = Array.from(draggedToken.parentElement.children).indexOf(draggedToken);
        cell.appendChild(draggedToken);

        sendNetworkData({ isNew: false, oldX, oldY, tokenIndex, x: gameX, y: gameY, senderRole: myRole });
        console.log(`You moved a token to ${LETTERS[gameX]}${gameY + 1}.`);
      }
    });
  }

  // ==========================================================================
  // BOARD — GRID INITIALIZATION
  // ==========================================================================

  for (let i = 0; i < COLUMNS * ROWS; i++) {
    const col = i % COLUMNS;
    const row = Math.floor(i / COLUMNS);

    if (row === 0 && col === 0) {
      board.appendChild(createDiv('label', ''));
    } else if (row === 0) {
      board.appendChild(createDiv('label', LETTERS[col - 1]));
    } else if (col === 0) {
      board.appendChild(createDiv('label', row));
    } else {
      const gameX = col - 1;
      const gameY = row - 1;
      const cell  = createDiv('cell', '');
      cell.dataset.x = gameX;
      cell.dataset.y = gameY;

      // --- MAP DESIGN PRESETS ---
      if (gameX === 0 && gameY === 0) cell.setAttribute('data-wall-right',   'true');
      if (gameX === 1 && gameY === 1) cell.setAttribute('data-window-right', 'true');

      configureGridCellEvents(cell, gameX, gameY);
      board.appendChild(cell);
    }
  }

  // ==========================================================================
  // SUPPLY DEPOT — INITIALIZATION
  // ==========================================================================

  // null entries produce empty slots; color strings produce draggable tokens
  const SUPPLY_ITEMS = [null, 'light-blue', 'dark-blue', 'pink', 'red', null, null, null, null, null];

  SUPPLY_ITEMS.forEach(color => {
    const slot = document.createElement('div');
    slot.classList.add('supply-slot');

    if (color) {
      const token = document.createElement('div');
      token.classList.add('token', color);
      token.setAttribute('draggable', 'true');
      bindTokenDragEvents(token, true);
      slot.appendChild(token);
    }

    supplyGrid.appendChild(slot);
  });

  // ==========================================================================
  // TRASH BIN — INITIALIZATION
  // ==========================================================================

  trashBin.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  });

  trashBin.addEventListener('drop', (event) => {
    event.preventDefault();
    if (!draggedToken || isSupplyToken) return;

    const oldX       = parseInt(draggedToken.parentElement.dataset.x);
    const oldY       = parseInt(draggedToken.parentElement.dataset.y);
    const tokenIndex = Array.from(draggedToken.parentElement.children).indexOf(draggedToken);
    draggedToken.remove();

    sendNetworkData({ isDelete: true, oldX, oldY, tokenIndex, senderRole: myRole });
  });

  // ==========================================================================
  // COPY LINK — INITIALIZATION
  // ==========================================================================

  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const url = window.location.href;

      try {
        // Prefer the modern async clipboard API
        await navigator.clipboard.writeText(url);
      } catch {
        // Fallback for browsers that block clipboard access
        try {
          const input = Object.assign(document.createElement('input'), {
            value: url,
            style: 'position:absolute;left:-9999px',
          });
          document.body.appendChild(input);
          input.select();
          input.setSelectionRange(0, 99999);
          document.execCommand('copy');
          document.body.removeChild(input);
        } catch (fallbackErr) {
          console.error('Copy failed:', fallbackErr);
          statusText.innerText = '⚠️ Copy blocked — paste from the address bar.';
          return;
        }
      }

      const previousText = statusText.innerText;
      statusText.innerText = '📋 Link copied!';
      setTimeout(() => { statusText.innerText = previousText; }, 3000);
    });
  }

});