window.addEventListener('load', function() {

  // ==========================================================================
  // GLOBALS
  // ==========================================================================
  const letters = ['A','B','C','D','E','F','G','H','I','J','K','L','M'];
  const board = document.getElementById('game-board');
  const miniMap = document.getElementById('mini-map');
  const columns = 14;
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
      transformToStartNewGameButton();
    });
  }

  function transformToStartNewGameButton() {
    if (copyBtn) {
      copyBtn.innerText = "🔄 Start New Game";
      copyBtn.onclick = function() {
        window.location.href = "https://cpmoellendorf.github.io/SWAT/";
      };
      copyBtn.style.display = 'inline-block'; 
    }
  }

  try {
    peer = new Peer();

    peer.on('open', (id) => {
      if (!targetPeerId) {
        window.location.hash = id;
        statusText.innerText = "Ready! Copy link and send to Player 2.";
        if (guideCard) guideCard.classList.remove('attack');
        if (copyBtn) copyBtn.style.display = 'inline-block'; 
      } else {
        if (guideCard) {
          guideCard.classList.add('attack');
          const header = guideCard.querySelector('.guide-header');
          if (header) header.innerText = "ATTACK";
        }
        if (copyBtn) copyBtn.style.display = 'none';
        connectToHost();
      }
    });

    peer.on('connection', (conn) => {
      connection = conn;
      setupConnectionListeners();
      statusText.innerText = "🟢 Player 2 Connected! Game Live.";
      transformToStartNewGameButton();
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

  if (copyBtn) {
    copyBtn.onclick = function() {
      navigator.clipboard.writeText(window.location.href).then(() => {
        const oldText = statusText.innerText;
        statusText.innerText = "📋 Link Copied to Clipboard!";
        setTimeout(() => { statusText.innerText = oldText; }, 3000);
      });
    };
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
      
      // CLOCK ENGINE LIVE SYNCHRONIZATION
      if (data.isClockSync) {
        defTime = data.defTime;
        offTime = data.offTime;
        activeTurn = data.activeTurn;
        isClockRunning = data.isClockRunning;
        currentMove = data.currentMove;
        updateClockUI();
        return;
      }

      const opponentLetter = letters[data.x - 1] || `#${data.x}`;
      const opponentNumber = data.y;

      // Handle Cross-Map Transfer
      if (data.isCrossMapTransfer) {
        const sourceMap = data.sourceIsMiniMap ? miniMap : board;
        // Search globally by dataset (allows finding labels and cells)
        const oldCell = sourceMap.querySelector(`[data-x="${data.oldX}"][data-y="${data.oldY}"]`);
        if (oldCell && oldCell.children[data.tokenIndex]) {
          oldCell.children[data.tokenIndex].remove();
        }

        if (data.isMiniMap) {
          const targetCell = miniMap.querySelector(`[data-x="${data.x}"][data-y="${data.y}"]`);
          if (targetCell) {
            const remoteToken = document.createElement('div');
            remoteToken.className = `token ${data.color}`;
            remoteToken.innerText = data.textLabel || '';
            remoteToken.setAttribute('draggable', 'true');
            bindTokenDragEvents(remoteToken, false);
            targetCell.appendChild(remoteToken);
          }
        }
        return;
      }

      if (data.isMiniMap) {
        const targetCell = miniMap.querySelector(`[data-x="${data.x}"][data-y="${data.y}"]`);
        if (!targetCell) return;

        if (data.isNew) {
          const remoteToken = document.createElement('div');
          remoteToken.className = `token ${data.color}`;
          remoteToken.innerText = data.textLabel || '';
          remoteToken.setAttribute('draggable', 'true');
          bindTokenDragEvents(remoteToken, false);
          targetCell.appendChild(remoteToken);
        } else if (data.isDelete) {
          const oldCell = miniMap.querySelector(`[data-x="${data.oldX}"][data-y="${data.oldY}"]`);
          if (oldCell && oldCell.children[data.tokenIndex]) {
            oldCell.children[data.tokenIndex].remove();
          }
        } else {
          const oldCell = miniMap.querySelector(`[data-x="${data.oldX}"][data-y="${data.oldY}"]`);
          if (oldCell) {
            const tokenToMove = Array.from(oldCell.children).find(child => child.classList.contains(data.color || 'token'));
            if (tokenToMove) {
              targetCell.appendChild(tokenToMove);
            }
          }
        }
        return;
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
      event.dataTransfer.dropEffect = 'move';
    });

    cell.addEventListener('drop', function(event) {
      event.preventDefault();
      if (!draggedToken) return;

      const sourceIsMiniMap = !!draggedToken.parentElement.closest('#mini-map');
      const colorClass = Array.from(draggedToken.classList).find(c => c !== 'token' && c !== 'dragging') || '';
      const textLabel = draggedToken.innerText;

      if (isSupplyToken) {
        const tokenClone = draggedToken.cloneNode(true);
        tokenClone.classList.remove('dragging');

        bindTokenDragEvents(tokenClone, false);
        cell.appendChild(tokenClone);

        if (isMiniMapBoard) {
          sendNetworkData({ isMiniMap: true, isNew: true, color: colorClass, textLabel: textLabel, x: gameX, y: gameY });
        } else {
          sendNetworkData({ isNew: true, color: colorClass, textLabel: textLabel, x: gameX, y: gameY });
        }
      } 
      else {
        const oldX = parseInt(draggedToken.parentElement.dataset.x);
        const oldY = parseInt(draggedToken.parentElement.dataset.y);
        const tokenIndex = Array.from(draggedToken.parentElement.children).indexOf(draggedToken);
        const isCrossMap = sourceIsMiniMap !== isMiniMapBoard;

        cell.appendChild(draggedToken);

        if (isCrossMap) {
          sendNetworkData({
            isCrossMapTransfer: true,
            sourceIsMiniMap: sourceIsMiniMap,
            isMiniMap: isMiniMapBoard,
            color: colorClass,
            textLabel: textLabel,
            oldX: oldX,
            oldY: oldY,
            tokenIndex: tokenIndex,
            x: gameX,
            y: gameY
          });
        } else {
          if (isMiniMapBoard) {
            sendNetworkData({ isMiniMap: true, isNew: false, color: colorClass, textLabel: textLabel, oldX: oldX, oldY: oldY, x: gameX, y: gameY });
          } else {
            sendNetworkData({ isNew: false, oldX: oldX, oldY: oldY, x: gameX, y: gameY });
          }
        }
      }
    });
  }

  // ==========================================================================
  // GRID GENERATORS
  // ==========================================================================
  if (board && miniMap) {
    for (let i = 0; i < totalCells; i++) {
      const col = i % columns;
      const row = Math.floor(i / columns);

      let labelText = '';
      if (row === 0 && col !== 0) labelText = letters[col - 1];
      if (col === 0 && row !== 0) labelText = row;

      const mainCellOrLabel = (row === 0 || col === 0 || row === 10 || col === 13) ? createDiv('label', labelText) : createDiv('cell', '');
      const miniCellOrLabel = (row === 0 || col === 0 || row === 10 || col === 13) ? createDiv('label', labelText) : createDiv('cell', '');

      // ALWAYS configure coordinates + events so tokens can drop everywhere (even labels)
      mainCellOrLabel.dataset.x = col;
      mainCellOrLabel.dataset.y = row;
      miniCellOrLabel.dataset.x = col;
      miniCellOrLabel.dataset.y = row;

      configureGridCellEvents(mainCellOrLabel, col, row, false);
      configureGridCellEvents(miniCellOrLabel, col, row, true);

      // ONLY apply walls/windows constraints to actual map borders
      if (row !== 0 && col !== 0 && row !== 10 && col !== 13) {
        const gameX = col - 1;
        const gameY = row - 1;
        
        // Row 0
        if (gameX === 7 && gameY === 0) { mainCellOrLabel.setAttribute('data-window-top', 'true'); miniCellOrLabel.setAttribute('data-window-top', 'true'); }
        if (gameX > 7 && gameX <= 10 && gameY === 0) { mainCellOrLabel.setAttribute('data-wall-top', 'true'); miniCellOrLabel.setAttribute('data-wall-top', 'true'); }
        if (gameX === 6 && gameY === 0) { mainCellOrLabel.setAttribute('data-wall-right', 'true'); miniCellOrLabel.setAttribute('data-wall-right', 'true'); }
        if (gameX === 1 && gameY === 0) { mainCellOrLabel.setAttribute('data-wall-bottom', 'true'); miniCellOrLabel.setAttribute('data-wall-bottom', 'true'); } 
        if (gameX >= 4 && gameX <= 6 && gameY === 0) { mainCellOrLabel.setAttribute('data-wall-bottom', 'true'); miniCellOrLabel.setAttribute('data-wall-bottom', 'true'); }      
        // Row 1
        if ((gameX === 0 || gameX === 1 || gameX === 2 || gameX === 6 || gameX === 10) && gameY === 1) { mainCellOrLabel.setAttribute('data-wall-right', 'true'); miniCellOrLabel.setAttribute('data-wall-right', 'true'); }
        if ((gameX === 1 || gameX === 10) && gameY === 1) { mainCellOrLabel.setAttribute('data-wall-bottom', 'true'); miniCellOrLabel.setAttribute('data-wall-bottom', 'true'); } 
        // Row 2
        if ((gameX === 2 || gameX === 9) && gameY === 2) { mainCellOrLabel.setAttribute('data-wall-right', 'true'); miniCellOrLabel.setAttribute('data-wall-right', 'true'); }
        if ((gameX === 1 || gameX === 2 || gameX === 8) && gameY === 2) { mainCellOrLabel.setAttribute('data-wall-bottom', 'true'); miniCellOrLabel.setAttribute('data-wall-bottom', 'true'); }     
        // Row 3
        if ((gameX === 2 || gameX === 6 || gameX === 9) && gameY === 3) { mainCellOrLabel.setAttribute('data-wall-right', 'true'); miniCellOrLabel.setAttribute('data-wall-right', 'true'); }
        if (gameX === 0 && gameY === 3) { mainCellOrLabel.setAttribute('data-window-right', 'true'); miniCellOrLabel.setAttribute('data-window-right', 'true'); }      
        if ((gameX === 3 || gameX === 4 || gameX === 6 || gameX === 7 || gameX === 9) && gameY === 3) { mainCellOrLabel.setAttribute('data-wall-bottom', 'true'); miniCellOrLabel.setAttribute('data-wall-bottom', 'true'); }
        if ((gameX === 10) && gameY === 3) { mainCellOrLabel.setAttribute('data-window-bottom', 'true'); miniCellOrLabel.setAttribute('data-window-bottom', 'true'); }
        // Row 4
        if ((gameX === 0 || gameX === 9 || gameX === 11) && gameY === 4) { mainCellOrLabel.setAttribute('data-wall-right', 'true'); miniCellOrLabel.setAttribute('data-wall-right', 'true'); }
        if ((gameX === 2 || gameX === 3 || gameX === 6) && gameY === 4) { mainCellOrLabel.setAttribute('data-wall-bottom', 'true'); miniCellOrLabel.setAttribute('data-wall-bottom', 'true'); }
        // Row 5
        if ((gameX === 2 || gameX === 6 || gameX === 11) && gameY === 5) { mainCellOrLabel.setAttribute('data-wall-right', 'true'); miniCellOrLabel.setAttribute('data-wall-right', 'true'); }
        if (gameX === 10 && gameY === 5) { mainCellOrLabel.setAttribute('data-wall-bottom', 'true'); miniCellOrLabel.setAttribute('data-wall-bottom', 'true'); }
        // Row 6
        if ((gameX === 2 || gameX === 6 || gameX === 9) && gameY === 6) { mainCellOrLabel.setAttribute('data-wall-right', 'true'); miniCellOrLabel.setAttribute('data-wall-right', 'true'); }
        if ((gameX === 0 || gameX === 7 || gameX === 9) && gameY === 6) { mainCellOrLabel.setAttribute('data-wall-bottom', 'true'); miniCellOrLabel.setAttribute('data-wall-bottom', 'true'); }
        // Row 7
        if ((gameX === 0 || gameX === 2 || gameX === 4 || gameX === 6) && gameY === 7) { mainCellOrLabel.setAttribute('data-wall-right', 'true'); miniCellOrLabel.setAttribute('data-wall-right', 'true'); }
        if ((gameX === 0  || gameX === 4 || gameX === 5) && gameY === 7) { mainCellOrLabel.setAttribute('data-wall-bottom', 'true'); miniCellOrLabel.setAttribute('data-wall-bottom', 'true'); }
        if ((gameX === 3  || gameX === 6) && gameY === 7) { mainCellOrLabel.setAttribute('data-window-bottom', 'true'); miniCellOrLabel.setAttribute('data-window-bottom', 'true'); }
        if (gameX === 0 && gameY === 7) { mainCellOrLabel.setAttribute('data-wall-left', 'true'); miniCellOrLabel.setAttribute('data-wall-left', 'true'); }
        if (gameX === 0 && gameY === 8) { mainCellOrLabel.setAttribute('data-wall-top', 'true'); miniCellOrLabel.setAttribute('data-wall-top', 'true'); }            
      }

      board.appendChild(mainCellOrLabel);
      miniMap.appendChild(miniCellOrLabel);
    }
  }

  function createDiv(className, text) {
    const el = document.createElement('div');
    el.className = className;
    // WRAPS static label text in a span so it sits cleanly beneath the tokens
    if (className === 'label' && text !== '') {
      const span = document.createElement('span');
      span.className = 'label-text';
      span.innerText = text;
      el.appendChild(span);
    } else {
      el.innerText = text;
    }
    return el;
  }

  // ==========================================================================
  // SUPPLY DEPOT & TRASH BIN
  // ==========================================================================
  const supplyGrid = document.getElementById('supply-grid');
  const trashBin = document.getElementById('trash-bin');
  
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
    null 
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

  if (guideCard) {
    guideCard.addEventListener('click', function(event) {
      const bar = event.target.closest('.action-bar');
      if (bar) {
        bar.classList.toggle('muted');
      }
    });
  }

  // ==========================================================================
  // REAL-TIME CHESS CLOCK ENGINE
  // ==========================================================================
  let defTime = 600; 
  let offTime = 600; 
  let activeTurn = 'defense'; 
  let isClockRunning = false;
  let currentMove = 1;

  const defClockBox = document.getElementById('defense-clock');
  const offClockBox = document.getElementById('offense-clock');
  const defTimeDisplay = defClockBox ? defClockBox.querySelector('.clock-time') : null;
  const offTimeDisplay = offClockBox ? offClockBox.querySelector('.clock-time') : null;
  const playPauseBtn = document.getElementById('play-pause-btn');
  const moveCounterDisplay = document.getElementById('move-counter');

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function updateClockUI() {
    if (!defClockBox || !offClockBox) return;
    defTimeDisplay.innerText = formatTime(defTime);
    offTimeDisplay.innerText = formatTime(offTime);
    moveCounterDisplay.innerText = `Move: ${currentMove}`;

    defClockBox.className = 'clock-box';
    offClockBox.className = 'clock-box';

    if (!isClockRunning) {
      playPauseBtn.innerText = (defTime === 600 && offTime === 600 && currentMove === 1) ? "▶️ START" : "▶️ RESUME";
      defClockBox.classList.add('inactive');
      offClockBox.classList.add('inactive');
    } else {
      playPauseBtn.innerText = "⏸ PAUSE";
      if (activeTurn === 'defense') {
        defClockBox.classList.add('active-defense');
        offClockBox.classList.add('inactive');
      } else {
        defClockBox.classList.add('inactive');
        offClockBox.classList.add('active-offense');
      }
    }
  }

  function tickClock() {
    if (!isClockRunning) return;
    if (activeTurn === 'defense' && defTime > 0) {
      defTime--;
    } else if (activeTurn === 'offense' && offTime > 0) {
      offTime--;
    }
    updateClockUI();
  }

  setInterval(tickClock, 1000);

  function syncClockState() {
    sendNetworkData({
      isClockSync: true,
      defTime: defTime,
      offTime: offTime,
      activeTurn: activeTurn,
      isClockRunning: isClockRunning,
      currentMove: currentMove
    });
  }

  function handleTurnSwitch(clickedByRole) {
    if (!isClockRunning) return; 
    if (activeTurn !== clickedByRole) return; 

    if (activeTurn === 'defense') {
      activeTurn = 'offense';
    } else {
      activeTurn = 'defense';
      currentMove++; 
    }

    updateClockUI();
    syncClockState(); 
  }

  if (playPauseBtn) {
    playPauseBtn.addEventListener('click', () => {
      isClockRunning = !isClockRunning;
      updateClockUI();
      syncClockState();
    });
  }

  if (defClockBox) {
    defClockBox.addEventListener('click', () => {
      handleTurnSwitch('defense');
    });
  }

  if (offClockBox) {
    offClockBox.addEventListener('click', () => {
      handleTurnSwitch('offense');
    });
  }

  updateClockUI();

});