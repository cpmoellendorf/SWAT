window.addEventListener('load', function() {

  // ==========================================================================
  // GLOBALS
  // ==========================================================================
  const letters = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O'];
  const board = document.getElementById('game-board');
  const columns = 16;
  const rows = 11;
  const totalCells = columns * rows;

  let peer = null;
  let connection = null;
  let draggedToken = null;
  let isSupplyToken = false;

  let targetPeerId = window.location.hash.substring(1);

  const copyBtn = document.getElementById('copy-link-btn');
  const statusText = document.getElementById('link-status');
  const guideCard = document.querySelector('.guide-panel');

  // ==========================================================================
  // PEER-TO-PEER MULTIPLAYER ENGINE (With Auto-Retry)
  // ==========================================================================
  let retryCount = 0;
  const maxRetries = 5;

  function connectToHost() {
    statusText.innerText = `Connecting to Host... (Attempt ${retryCount + 1})`;
    connection = peer.connect(targetPeerId);

    connection.on('open', () => {
      setupConnectionListeners();
      statusText.innerText = "🟢 Connected to Host! Game Live.";
    });
  }

  try {
    peer = new Peer();

    peer.on('open', (id) => {
      if (!targetPeerId) {
        // Host side (Player 1 = Defense)
        window.location.hash = id;
        statusText.innerText = "Ready! Copy link and send to Player 2.";
        if (guideCard) guideCard.classList.remove('attack');
      } else {
        // Guest side (Player 2 = Attack)
        if (guideCard) {
          guideCard.classList.add('attack');
          guideCard.querySelector('.guide-header').innerText = "ATTACK";
        }
        connectToHost();
      }
    });

    peer.on('connection', (conn) => {
      connection = conn;
      setupConnectionListeners();
      statusText.innerText = "🟢 Player 2 Connected! Game Live.";
    });

    peer.on('error', (err) => {
      console.error("Multiplayer Connection Error:", err);
      if (err.type === 'peer-unavailable' && targetPeerId && retryCount < maxRetries) {
        retryCount++;
        statusText.innerText = "⚠️ Host layout loading... Retrying connection...";
        setTimeout(connectToHost, 1500);
      } else {
        statusText.innerText = "⚠️ Connection error. Type: " + err.type;
      }
    });

  } catch (error) {
    console.error("PeerJS completely failed to load:", error);
    statusText.innerText = "⚠️ Network initialization failed.";
  }

  // ==========================================================================
  // SHARE LINK
  // ==========================================================================
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      const oldText = statusText.innerText;
      statusText.innerText = "📋 Link Copied to Clipboard!";
      setTimeout(() => { statusText.innerText = oldText; }, 3000);
    });
  });

  // ==========================================================================
  // NETWORK
  // ==========================================================================
  function sendNetworkData(payload) {
    if (connection && connection.open) {
      connection.send(payload);
    }
  }

  function setupConnectionListeners() {
    connection.on('data', (data) => {
      const opponentLetter = letters[data.x];
      const opponentNumber = data.y + 1;

      if (data.isNew) {
        console.log(`📡 RADAR ALERT: Opponent instantiated a token on THEIR board at ${opponentLetter}${opponentNumber}.`);
      } else if (data.isDelete) {
        console.log(`📡 RADAR ALERT: Opponent deleted a token on THEIR board at ${letters[data.oldX]}${data.oldY + 1}.`);
      } else {
        console.log(`📡 RADAR ALERT: Opponent shifted a piece on THEIR map from ${letters[data.oldX]}${data.oldY + 1} to ${opponentLetter}${opponentNumber}.`);
      }
    });

    connection.on('close', () => {
      statusText.innerText = "🔴 Opponent disconnected.";
    });
  }

  // ==========================================================================
  // DRAG BINDINGS
  // ==========================================================================
  function bindTokenDragEvents(token, fromSupplyDepot) {
    token.addEventListener('dragstart', function(event) {
      draggedToken = token;
      isSupplyToken = fromSupplyDepot;
      event.dataTransfer.effectAllowed = 'move';
      setTimeout(() => { token.classList.add('dragging'); }, 1);
    });

    token.addEventListener('dragend', function() {
      token.classList.remove('dragging');
      draggedToken = null;
      isSupplyToken = false;
    });
  }

  // ==========================================================================
  // GRID CELL EVENT CONFIGURATION
  // ==========================================================================
  function configureGridCellEvents(cell, gameX, gameY) {
    cell.addEventListener('dragover', function(event) {
      event.preventDefault();
      const isIllegalZone = cell.matches('[data-wall-right="true"], [data-wall-bottom="true"], [data-window-right="true"], [data-window-bottom="true"]');
      event.dataTransfer.dropEffect = isIllegalZone ? 'none' : 'move';
    });

    cell.addEventListener('drop', function(event) {
      event.preventDefault();
      if (!draggedToken) return;

      const isWallOrWindow = cell.matches('[data-wall-right="true"], [data-wall-bottom="true"], [data-window-right="true"], [data-window-bottom="true"]');
      if (isWallOrWindow) return;

      if (isSupplyToken) {
        const tokenClone = draggedToken.cloneNode(true);
        tokenClone.classList.remove('dragging');
        const colorClass = Array.from(draggedToken.classList).find(c => c !== 'token' && c !== 'dragging') || '';

        bindTokenDragEvents(tokenClone, false);
        cell.appendChild(tokenClone);

        sendNetworkData({ isNew: true, color: colorClass, x: gameX, y: gameY });
        console.log(`You placed a token at ${letters[gameX]}${gameY + 1}.`);
      } else {
        const oldX = parseInt(draggedToken.parentElement.dataset.x);
        const oldY = parseInt(draggedToken.parentElement.dataset.y);

        cell.appendChild(draggedToken);

        sendNetworkData({ isNew: false, oldX: oldX, oldY: oldY, x: gameX, y: gameY });
        console.log(`You moved your token to ${letters[gameX]}${gameY + 1}.`);
      }
    });
  }

  // ==========================================================================
  // GRID GENERATOR
  // ==========================================================================
  for (let i = 0; i < totalCells; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);

    if (row === 0 && col === 0) board.appendChild(createDiv('label', ''));
    else if (row === 0)         board.appendChild(createDiv('label', letters[col - 1]));
    else if (col === 0)         board.appendChild(createDiv('label', row));
    else {
      const cell = createDiv('cell', '');
      const gameX = col - 1;
      const gameY = row - 1;
      cell.dataset.x = gameX;
      cell.dataset.y = gameY;

      // Map design presets
      if (gameX === 0 && gameY === 0) cell.setAttribute('data-wall-right', 'true');
      if (gameX === 1 && gameY === 1) cell.setAttribute('data-window-right', 'true');

      configureGridCellEvents(cell, gameX, gameY);
      board.appendChild(cell);
    }
  }

  function createDiv(className, text) {
    const el = document.createElement('div');
    el.className = className;
    el.innerText = text;
    return el;
  }

  // ==========================================================================
  // SUPPLY DEPOT & TRASH BIN
  // ==========================================================================
  const supplyGrid = document.getElementById('supply-grid');
  const trashBin = document.getElementById('trash-bin');
  const supplyItems = ['', 'light-blue', 'dark-blue', 'pink', 'red', '', '', '', '', ''];

  for (let i = 0; i < 10; i++) {
    const slot = document.createElement('div');
    slot.classList.add('supply-slot');
    if (supplyItems[i] !== undefined) {
      const supplyToken = document.createElement('div');
      supplyToken.classList.add('token');
      supplyToken.setAttribute('draggable', 'true');
      if (supplyItems[i]) supplyToken.classList.add(supplyItems[i]);
      bindTokenDragEvents(supplyToken, true);
      slot.appendChild(supplyToken);
    }
    supplyGrid.appendChild(slot);
  }

  trashBin.addEventListener('dragover', function(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  });

  trashBin.addEventListener('drop', function(event) {
    event.preventDefault();
    if (draggedToken && !isSupplyToken) {
      const oldX = parseInt(draggedToken.parentElement.dataset.x);
      const oldY = parseInt(draggedToken.parentElement.dataset.y);
      const tokenIndex = Array.from(draggedToken.parentElement.children).indexOf(draggedToken);

      draggedToken.remove();

      sendNetworkData({ isDelete: true, oldX: oldX, oldY: oldY, tokenIndex: tokenIndex });
    }
  });

});