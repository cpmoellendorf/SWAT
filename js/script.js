window.addEventListener('load', function() {

  // ==========================================================================
  // GLOBAL CORE SYSTEM VARIATION SETUP
  // ==========================================================================
  const letters = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O'];
  const board = document.getElementById('game-board');
  const columns = 16; 
  const rows = 11;
  const totalCells = columns * rows;

  let peer = null;
  let draggedToken = null;
  let isSupplyToken = false;

  // Track multiple live connections simultaneously in our roster array
  let activeConnections = [];
  
  // Read the room ID from the link hash
  let roomHash = window.location.hash.substring(1);
  let myRole = 'defense-1'; // Default role assumption

  const copyBtn = document.getElementById('copy-link-btn');
  const statusText = document.getElementById('link-status');

  // FIXED: Safety check to find the panel anywhere inside your sidebar wrappers
  const guideCard = document.querySelector('.guide-panel') || document.querySelector('.guide-sidebar-wrapper .guide-panel');

  // ==========================================================================
  // 4-PLAYER MESH NETWORKING INITIALIZATION
  // ==========================================================================
  if (!roomHash) {
    // --- PLAYER 1 (Lobby Creator / Host) ---
    roomHash = Math.random().toString(36).substring(2, 9);
    window.location.hash = roomHash;
    
    peer = new Peer(roomHash, { debug: 2, config: { iceServers: [{ urls: 'stun:://google.com' }] } });

    myRole = 'defense-1';
    
    peer.on('open', () => {
      statusText.innerText = "Lobby Created! Send link to Players 2, 3, and 4 (0/3 Joined).";
    });
  } else {
    // --- GUESTS (Players 2, 3, and 4) ---
    peer = new Peer({ debug: 2, config: { iceServers: [{ urls: 'stun:://google.com' }] } });

    
    peer.on('open', () => {
      statusText.innerText = "Connecting to lobby mesh...";
      
      const hostConn = peer.connect(roomHash);
      setupConnectionListeners(hostConn);
    });
  }

  // ... [Leave the rest of your functions like peer.on('connection'), loops, and drag bindings exactly as they were below]

  // Handle incoming connections from any player in the mesh
  peer.on('connection', (conn) => {
    setupConnectionListeners(conn);
  });

  peer.on('error', (err) => {
    console.error("Mesh Network Error:", err);
    statusText.innerText = "⚠️ Network issue. Type: " + err.type;
  });

  // ==========================================================================
  // UNIFIED BROADCAST SYSTEM
  // ==========================================================================
  function sendNetworkData(payload) {
    activeConnections.forEach(conn => {
      if (conn && conn.open) {
        conn.send(payload);
      }
    });
  }

  // ==========================================================================
  // MESH CONNECTION TRACKER & INBOUND LISTENER (Fixed Roster Sync)
  // ==========================================================================
  function setupConnectionListeners(conn) {
    
    conn.on('open', () => {
      // Add the connection to our active roster array if it isn't already there
      if (!activeConnections.find(c => c.peer === conn.peer)) {
        activeConnections.push(conn);
      }

      // If I am the Host, assign roles and broadcast the total player count to EVERYONE
      if (myRole === 'defense-1') {
        const slots = ['attack-1', 'defense-2', 'attack-2'];
        const assignedRole = slots[activeConnections.length - 1] || 'spectator';
        
        // A 100ms timeout ensures the network pipe is 100% stable before sending data
        setTimeout(() => {
          // 1. Send the role directly to the newcomer
          conn.send({ type: 'assign-role', role: assignedRole });

          // 2. Introduce the newcomer to all previous peers currently in the lobby
          const otherPeerIds = activeConnections
            .filter(c => c.peer !== conn.peer)
            .map(c => c.peer);

          if (otherPeerIds.length > 0) {
            conn.send({ type: 'introduce-peers', peerIds: otherPeerIds });
          }

          // 3. NEW: Broadcast a global lobby sync update to ALL connected players
          const totalPlayers = activeConnections.length + 1;
          sendNetworkData({ type: 'lobby-sync', count: totalPlayers });
          
          // Update the Host's own screen text
          updateLobbyStatus();
        }, 100);
      }
    });

    conn.on('data', (data) => {
      if (!data) return;

      // --- INTERNAL MULTIPLAYER SYSTEM SIGNALS ---
      if (data.type === 'assign-role') {
        myRole = data.role;
        applyVisualRoleProperties(data.role);
        return;
      }
      if (data.type === 'introduce-peers') {
        data.peerIds.forEach(id => {
          if (!activeConnections.find(c => c.peer === id)) {
            const peerConn = peer.connect(id);
            setupConnectionListeners(peerConn);
          }
        });
        return;
      }
      if (data.type === 'lobby-sync') {
        statusText.innerText = `🟢 Players: ${data.count}/4 (Role: ${myRole.toUpperCase()})`;
        return;
      }

      // ==========================================================================
      // TEAM-AWARE GAMEPLAY SYNC FILTER (Shared Team Grids)
      // ==========================================================================
      
      // 1. Parse who sent this data packet (e.g., 'defense' or 'attack')
      const senderTeam = data.senderRole.split('-')[0]; // Extracts 'defense' or 'attack'
      const myTeam = myRole.split('-')[0];             // Extracts your own team name
      
      // Convert coordinates for text log readouts
      const opponentLetter = letters[data.x];
      const opponentNumber = data.y + 1;

      // CHECK: Is the player who moved this token on my team?
      if (senderTeam === myTeam) {
        
        // --- VISUAL SYNC: Update our shared map grid in real-time ---
        if (data.isNew) {
          const targetCell = board.querySelector(`.cell[data-x="${data.x}"][data-y="${data.y}"]`);
          if (targetCell) {
            const remoteToken = document.createElement('div');
            remoteToken.classList.add('token');
            remoteToken.setAttribute('draggable', 'true');
            if (data.color) remoteToken.classList.add(data.color);
            bindTokenDragEvents(remoteToken, false);
            targetCell.appendChild(remoteToken);
          }
          console.log(`🤝 TEAM UPDATE: Your teammate placed a token at ${opponentLetter}${opponentNumber}.`);
        } 
        else if (data.isDelete) {
          const targetCell = board.querySelector(`.cell[data-x="${data.oldX}"][data-y="${data.oldY}"]`);
          if (targetCell) {
            const tokenToDelete = targetCell.children[data.tokenIndex];
            if (tokenToDelete) tokenToDelete.remove();
          }
          console.log(`🤝 TEAM UPDATE: Your teammate deleted a token at ${letters[data.oldX]}${data.oldY + 1}.`);
        } 
        else {
          const sourceCell = board.querySelector(`.cell[data-x="${data.oldX}"][data-y="${data.oldY}"]`);
          const targetCell = board.querySelector(`.cell[data-x="${data.x}"][data-y="${data.y}"]`);
          
          if (sourceCell && targetCell) {
            const remoteTokenToMove = sourceCell.children[data.tokenIndex] || sourceCell.querySelector('.token');
            if (remoteTokenToMove) targetCell.appendChild(remoteTokenToMove);
          }
          console.log(`🤝 TEAM UPDATE: Your teammate shifted a token to ${opponentLetter}${opponentNumber}.`);
        }

      } else {
        // --- INTEL LOCKDOWN: Hide the enemy movement from our grid ---
        // The token does NOT spawn or move on your map layout box, keeping your board private.
        if (data.isNew) {
          console.log(`📡 ENEMY INTEL: Opponent (${data.senderRole.toUpperCase()}) spawned a token hidden on THEIR board.`);
        } else {
          console.log(`📡 ENEMY INTEL: Opponent (${data.senderRole.toUpperCase()}) moved a piece on THEIR map.`);
        }
      }
    });


    conn.on('close', () => {
      activeConnections = activeConnections.filter(c => c.peer !== conn.peer);
      updateLobbyStatus();
    });
  }

  // ==========================================================================
  // HELPERS FOR VISUAL ROLE STATES & LOBBY STATUS
  // ==========================================================================
  function updateLobbyStatus() {
    const totalPlayers = activeConnections.length + 1;
    statusText.innerText = `🟢 Players in Game: ${totalPlayers} / 4 (You: ${myRole.toUpperCase()})`;
  }

  function applyVisualRoleProperties(role) {
    if (!guideCard) return;
    
    if (role.startsWith('attack')) {
      guideCard.classList.add('attack');
      guideCard.querySelector('.guide-header').innerText = `ATTACK (${role.toUpperCase()})`;
    } else {
      guideCard.classList.remove('attack');
      guideCard.querySelector('.guide-header').innerText = `DEFENSE (${role.toUpperCase()})`;
    }
    updateLobbyStatus();
  }


  // ==========================================================================
  // CENTRALIZED COMPONENT DRAG BINDINGS
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
  // GRID BOARD INTERACTION CAPABILITIES & BOUNDARY LOCKDOWN
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
      // 1. Instantiate the token completely on your own board
      const tokenClone = draggedToken.cloneNode(true);
      tokenClone.classList.remove('dragging');
      const colorClass = Array.from(draggedToken.classList).find(c => c !== 'token' && c !== 'dragging') || '';
      
      bindTokenDragEvents(tokenClone, false);
      cell.appendChild(tokenClone); // Stays local to your screen!

      // 2. Alert your opponent of your action wirelessly
      sendNetworkData({ 
      isNew: true, 
      color: colorClass, 
      x: gameX, 
      y: gameY,
      senderRole: myRole // NEW: Tells the network who placed this item
      });


      
      console.log(`You placed a token at ${letters[gameX]}${gameY + 1}.`);
    } else {
      // 1. Move the existing piece locally on your own board
      const oldX = parseInt(draggedToken.parentElement.dataset.x);
      const oldY = parseInt(draggedToken.parentElement.dataset.y);
      
      cell.appendChild(draggedToken); // Stays local to your screen!

      // 2. Alert your opponent of your relocation wirelessly
      const tokenIndex = Array.from(draggedToken.parentElement.children).indexOf(draggedToken);

      sendNetworkData({ 
        isNew: false, 
        oldX: oldX, 
        oldY: oldY, 
        tokenIndex: tokenIndex, // Keeps multi-stack order mapping working
        x: gameX, 
        y: gameY,
        senderRole: myRole // NEW: Tells the network who moved this item
      });
      
      console.log(`You moved your token to ${letters[gameX]}${gameY + 1}.`);
    }
  });
  }

  // ==========================================================================
  // GRID GENERATOR INITIALIZATION LOOP
  // ==========================================================================
  for (let i = 0; i < totalCells; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);

    if (row === 0 && col === 0) board.appendChild(createDiv('label', ''));
    else if (row === 0)          board.appendChild(createDiv('label', letters[col - 1]));
    else if (col === 0)          board.appendChild(createDiv('label', row));
    
    else {
      const cell = createDiv('cell', '');
      const gameX = col - 1; 
      const gameY = row - 1; 
      cell.dataset.x = gameX;
      cell.dataset.y = gameY;
      
      // --- MAP DESIGN PRESETS ---
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
  // SUPPLY DEPOT & TRASH BIN INITIALIZATION
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
      
      // Transmit deletion request to peer
      sendNetworkData({ isDelete: true, oldX: oldX, oldY: oldY, tokenIndex: tokenIndex });
    }
  });

  // ==========================================================================
  // [THIS IS THE TRASH BIN CODE ALREADY IN YOUR FILE]
  // ==========================================================================
  trashBin.addEventListener('dragover', function(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  });

  trashBin.addEventListener('drop', function(event) {
    event.preventDefault();
    if (draggedToken && !isSupplyToken) {
      const oldX = parseInt(draggedToken.parentElement.dataset.x);
      const oldY = parseInt(draggedToken.parentElement.dataset.y);
      draggedToken.remove();
      sendNetworkData({ isDelete: true, oldX: oldX, oldY: oldY });
    }
  });


  // ==========================================================================
  // PASTE THE NEW COPIER CODE RIGHT HERE:
  // ==========================================================================
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const urlToCopy = window.location.href;

      try {
        const tempInput = document.createElement('input');
        tempInput.style.position = 'absolute';
        tempInput.style.left = '-9999px';
        tempInput.value = urlToCopy;
        document.body.appendChild(tempInput);

        tempInput.select();
        tempInput.setSelectionRange(0, 99999); 

        const success = document.execCommand('copy');
        document.body.removeChild(tempInput); 

        if (success) {
          const oldText = statusText.innerText;
          statusText.innerText = "📋 Link Copied to Clipboard!";
          setTimeout(() => { statusText.innerText = oldText; }, 3000);
        } else {
          throw new Error("execCommand returned false");
        }

      } catch (err) {
        console.error("Fallback copy failed:", err);
        statusText.innerText = "⚠️ Copy blocked. Please copy from the address bar.";
      }
    });
  }




});

