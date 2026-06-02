window.addEventListener('load', function() {

  // ==========================================================================
  // GLOBALS
  // ==========================================================================
  const letters = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O'];
  const board = document.getElementById('game-board');
  const miniMap = document.getElementById('mini-map');
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
          const header = guideCard.querySelector('.guide-header');
          if (header) header.innerText = "ATTACK";
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
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(window.location.href).then(() => {
        const oldText = statusText.innerText;
        statusText.innerText = "📋 Link Copied to Clipboard!";
        setTimeout(() => { statusText.innerText = oldText; }, 3000);
      });
    });
  }

  // ==========================================================================
  // NETWORK RECEIVER & SYNC ENGINE
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

      if (data.isMiniMap) {
        const targetCell = miniMap.querySelector(`.cell[data-x="${data.x}"][data-y="${data.y}"]`);
        if (!targetCell) return;

        if (data.isNew) {
          const remoteToken = document.createElement('div');
          remoteToken.className = `token ${data.color}`;
          remoteToken.innerText = data.textLabel || '';
          remoteToken.setAttribute('draggable', 'true');
          bindTokenDragEvents(remoteToken, false);
          targetCell.appendChild(remoteToken);
        } else if (data.isDelete) {
          const oldCell = miniMap.querySelector(`.cell[data-x="${data.oldX}"][data-y="${data.oldY}"]`);
          if (oldCell && oldCell.children[data.tokenIndex]) {
            oldCell.children[data.tokenIndex].remove();
          }
        } else {
          const oldCell = miniMap.querySelector(`.cell[data-x="${data.oldX}"][data-y="${data.oldY}"]`);
          if (oldCell) {
            const tokenToMove = Array.from(oldCell.children).find(child => child.classList.contains(data.color || 'token'));
            if (tokenToMove) {
              targetCell.appendChild(tokenToMove);
            }
          }
        }
        return;
      }

      if (data.isNew) {
        console.log(`📡 RADAR ALERT: Opponent instantiated a token [${data.textLabel || 'Blank'}] on THEIR board at ${opponentLetter}${opponentNumber}.`);
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
  function configureGridCellEvents(cell, gameX, gameY, isMiniMapBoard) {
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

      const sourceIsMiniMap = !!draggedToken.parentElement.closest('#mini-map');
      if (!isSupplyToken && (sourceIsMiniMap !== isMiniMapBoard)) return;

      const colorClass = Array.from(draggedToken.classList).find(c => c !== 'token' && c !== 'dragging') || '';
      const textLabel = draggedToken.innerText;

      if (isSupplyToken) {
        const tokenClone = draggedToken.cloneNode(true);
        tokenClone.classList.remove('dragging');

        bindTokenDragEvents(tokenClone, false);
        cell.appendChild(tokenClone);

        if (isMiniMapBoard) {
          sendNetworkData({ isMiniMap: true, isNew: true, color: colorClass, textLabel: textLabel, x: gameX, y: gameY });
          console.log(`Shared Mini-Map updated: Added token [${textLabel}] at ${letters[gameX]}${gameY + 1}.`);
        } else {
          sendNetworkData({ isNew: true, color: colorClass, textLabel: textLabel, x: gameX, y: gameY });
          console.log(`You placed a token [${textLabel}] at ${letters[gameX]}${gameY + 1}.`);
        }
      } else {
        const oldX = parseInt(draggedToken.parentElement.dataset.x);
        const oldY = parseInt(draggedToken.parentElement.dataset.y);

        cell.appendChild(draggedToken);

        if (isMiniMapBoard) {
          sendNetworkData({ isMiniMap: true, isNew: false, color: colorClass, textLabel: textLabel, oldX: oldX, oldY: oldY, x: gameX, y: gameY });
          console.log(`Shared Mini-Map updated: Moved token to ${letters[gameX]}${gameY + 1}.`);
        } else {
          sendNetworkData({ isNew: false, oldX: oldX, oldY: oldY, x: gameX, y: gameY });
          console.log(`You moved your token to ${letters[gameX]}${gameY + 1}.`);
        }
      }
    });
  }

  // ==========================================================================
  // GRID GENERATORS (Simultaneous Twin Build)
  // ==========================================================================
  if (board && miniMap) {
    for (let i = 0; i < totalCells; i++) {
      const col = i % columns;
      const row = Math.floor(i / columns);

      let labelText = '';
      if (row === 0 && col !== 0) labelText = letters[col - 1];
      if (col === 0 && row !== 0) labelText = row;

      const mainCellOrLabel = (row === 0 || col === 0) ? createDiv('label', labelText) : createDiv('cell', '');
      const miniCellOrLabel = (row === 0 || col === 0) ? createDiv('label', labelText) : createDiv('cell', '');

      if (row !== 0 && col !== 0) {
        const gameX = col - 1;
        const gameY = row - 1;
        
        mainCellOrLabel.dataset.x = gameX;
        mainCellOrLabel.dataset.y = gameY;
        miniCellOrLabel.dataset.x = gameX;
        miniCellOrLabel.dataset.y = gameY;

        if (gameX === 0 && gameY === 0) {
          mainCellOrLabel.setAttribute('data-wall-right', 'true');
          miniCellOrLabel.setAttribute('data-wall-right', 'true');
        }
        if (gameX === 1 && gameY === 1) {
          mainCellOrLabel.setAttribute('data-window-right', 'true');
          miniCellOrLabel.setAttribute('data-window-right', 'true');
        }

        configureGridCellEvents(mainCellOrLabel, gameX, gameY, false);
        configureGridCellEvents(miniCellOrLabel, gameX, gameY, true);
      }

      board.appendChild(mainCellOrLabel);
      miniMap.appendChild(miniCellOrLabel);
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
  
  // Custom definitions array storing color classes and character typography strings
  const customSupplyItems = [
    { color: 'light-blue',  label: '' },
    { color: 'dark-blue',   label: '' },
    { color: 'orange',      label: '' },
    { color: 'red',         label: '' },
    { color: 'dark-green',  label: '' },
    { color: 'black',       label: 'D' },
    { color: 'grey',        label: 'X' },
    { color: 'light-green', label: 'AREA' },
    { color: 'grey',        label: 'AREA' },
    { color: 'blank-slot',  label: '' }
  ];

  if (supplyGrid) {
    for (let i = 0; i < 10; i++) {
      const slot = document.createElement('div');
      slot.classList.add('supply-slot');
      
      const config = customSupplyItems[i];
      if (config) {
        const supplyToken = document.createElement('div');
        supplyToken.classList.add('token');
        if (config.color) supplyToken.classList.add(config.color);
        supplyToken.innerText = config.label;
        supplyToken.setAttribute('draggable', 'true');
        
        bindTokenDragEvents(supplyToken, true);
        slot.appendChild(supplyToken);
      }
      supplyGrid.appendChild(slot);
    }
  }

  if (trashBin) {
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
        const isMiniMapBoard = !!draggedToken.parentElement.closest('#mini-map');

        draggedToken.remove();

        if (isMiniMapBoard) {
          sendNetworkData({ isMiniMap: true, isDelete: true, oldX: oldX, oldY: oldY, tokenIndex: tokenIndex });
        } else {
          sendNetworkData({ isDelete: true, oldX: oldX, oldY: oldY, tokenIndex: tokenIndex });
        }
      }
    });
  }

  // ==========================================================================
  // ROBUST DELEGATED INTERACTIVE TACTICAL GUIDE SHEET
  // ==========================================================================
  if (guideCard) {
    guideCard.addEventListener('click', function(event) {
      const bar = event.target.closest('.action-bar');
      if (bar) {
        bar.classList.toggle('muted');
      }
    });
  }

});