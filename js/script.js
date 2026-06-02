window.addEventListener('load', function() {

  // ==========================================================================
  // GLOBALS
  // ==========================================================================
  const letters = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N'];
  const board = document.getElementById('game-board');
  const miniMap = document.getElementById('mini-map');
  const columns = 15;
  const rows = 11;
  const totalCells = columns * rows;

  let peer = null;
  let connection = null;
  let draggedToken = null;
  let isSupplyToken = false;

  // Timer State
  let defenseTime = 17 * 60;
  let attackTime = 12 * 60;
  let isDefenseTurn = true;
  let isPaused = true;
  let turnCount = 1;

  const defDisplay = document.querySelector('#defense-timer .time-display');
  const atkDisplay = document.querySelector('#attack-timer .time-display');
  const timerBtn = document.getElementById('toggle-timer-btn');
  const turnDisp = document.getElementById('turn-counter');

  let targetPeerId = window.location.hash.substring(1);
  const copyBtn = document.getElementById('copy-link-btn');
  const statusText = document.getElementById('link-status');
  const guideCard = document.querySelector('.guide-panel');

  // ==========================================================================
  // TIMER ENGINE
  // ==========================================================================
  function updateDisplay() {
    defDisplay.innerText = `${Math.floor(defenseTime/60)}:${(defenseTime%60).toString().padStart(2, '0')}`;
    atkDisplay.innerText = `${Math.floor(attackTime/60)}:${(attackTime%60).toString().padStart(2, '0')}`;
  }

  setInterval(() => {
    if (!isPaused) {
      if (isDefenseTurn && defenseTime > 0) defenseTime--;
      else if (!isDefenseTurn && attackTime > 0) attackTime--;
      updateDisplay();
    }
  }, 1000);

  timerBtn.onclick = () => {
    isPaused = !isPaused;
    timerBtn.innerText = isPaused ? "▶️ Resume" : "⏸️ Pause";
    sendNetworkData({ type: 'TIMER_SYNC', isPaused, defenseTime, attackTime });
  };

  function switchTurn() {
    isDefenseTurn = !isDefenseTurn;
    if (isDefenseTurn) turnCount++;
    
    document.getElementById('defense-timer').classList.toggle('active-blue', isDefenseTurn);
    document.getElementById('attack-timer').classList.toggle('active-orange', !isDefenseTurn);
    turnDisp.innerText = `Turn: ${turnCount}`;
    
    sendNetworkData({ type: 'TURN_SYNC', isDefenseTurn, turnCount });
  }

  // ==========================================================================
  // PEER-TO-PEER ENGINE
  // ==========================================================================
  function connectToHost() {
    connection = peer.connect(targetPeerId);
    connection.on('open', setupConnectionListeners);
  }

  peer = new Peer();
  peer.on('open', (id) => {
    if (!targetPeerId) {
      window.location.hash = id;
    } else {
      if (guideCard) guideCard.classList.add('attack');
      connectToHost();
    }
  });

  peer.on('connection', (conn) => {
    connection = conn;
    setupConnectionListeners();
  });

  function sendNetworkData(payload) {
    if (connection && connection.open) connection.send(payload);
  }

  function setupConnectionListeners() {
    connection.on('data', (data) => {
      // Sync Timer/Turns
      if (data.type === 'TIMER_SYNC') {
        isPaused = data.isPaused;
        defenseTime = data.defenseTime;
        attackTime = data.attackTime;
        timerBtn.innerText = isPaused ? "▶️ Resume" : "⏸️ Pause";
        updateDisplay();
      }
      if (data.type === 'TURN_SYNC') {
        isDefenseTurn = data.isDefenseTurn;
        turnCount = data.turnCount;
        document.getElementById('defense-timer').classList.toggle('active-blue', isDefenseTurn);
        document.getElementById('attack-timer').classList.toggle('active-orange', !isDefenseTurn);
        turnDisp.innerText = `Turn: ${turnCount}`;
      }
      // Handle Existing Token Logic...
      // (Keep your existing data handling here)
    });
  }

  // ==========================================================================
  // MODIFIED DROP EVENT (Trigger Switch)
  // ==========================================================================
  function configureGridCellEvents(cell, gameX, gameY, isMiniMapBoard) {
    cell.addEventListener('drop', function(event) {
      event.preventDefault();
      // ... your existing drop logic ...
      
      // Auto-switch turn after successful move
      switchTurn();
    });
  }

  // ... (Keep existing generators and drag bindings from your original script)
});