function initChessSocket(io) {
  const chessNamespace = io.of('/chess');

  const rooms = new Map();
  // Key format: "entryFee" e.g. "500"
  // Chess is always 2 players, so we only need to group by entryFee
  const matchQueues = new Map(); // Map<queueKey, Array<{ socket, userData, entryFee }>>

  function getQueue(key) {
    if (!matchQueues.has(key)) {
      matchQueues.set(key, []);
    }
    return matchQueues.get(key);
  }

  function removeFromAllQueues(socketId) {
    for (const [key, queue] of matchQueues.entries()) {
      const idx = queue.findIndex(p => p.socket.id === socketId);
      if (idx !== -1) {
        queue.splice(idx, 1);
        if (queue.length === 0) matchQueues.delete(key);
        break;
      }
    }
  }

  chessNamespace.on('connection', (socket) => {
    console.log(`Chess Socket connected: ${socket.id}`);

    // Random Matchmaking
    socket.on('join_matchmaking', (data) => {
      const { entryFee = 0, userData } = data;
      const queueKey = `${entryFee}`;
      const queue = getQueue(queueKey);

      queue.push({ socket, userData, entryFee });
      console.log(`Chess Player ${socket.id} joined queue [${queueKey}], queue size: ${queue.length}`);

      if (queue.length >= 2) {
        const players = [];
        const roomId = `CHESS_MATCH_${Date.now()}`;

        for (let i = 0; i < 2; i++) {
          const p = queue.shift();
          p.socket.join(roomId);
          const playerColor = i === 0 ? 'w' : 'b';
          players.push({ id: p.socket.id, playerColor, userData: p.userData });
        }

        if (queue.length === 0) matchQueues.delete(queueKey);

        const roomState = {
          roomId,
          players,
          entryFee,
        };

        rooms.set(roomId, roomState);
        chessNamespace.to(roomId).emit('match_found', roomState);
        console.log(`Chess match found for queue [${queueKey}], roomId: ${roomId}`);
      }
    });

    socket.on('leave_matchmaking', () => {
      removeFromAllQueues(socket.id);
      console.log(`Chess Player ${socket.id} left matchmaking`);
    });

    // Create private room for chess
    socket.on('create_room', (data, callback) => {
      const { entryFee = 0, userData } = data;
      const roomId = `CHESS_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      socket.join(roomId);
      
      const roomState = {
        roomId,
        players: [{ id: socket.id, playerColor: 'w', userData }],
        entryFee,
      };
      rooms.set(roomId, roomState);
      callback({ success: true, roomId, roomState });
    });

    // Join private room for chess
    socket.on('join_room', (data, callback) => {
      const { roomId, userData } = data;
      const room = rooms.get(roomId);
      
      if (room) {
        if (room.players.length < 2) {
          socket.join(roomId);
          room.players.push({ id: socket.id, playerColor: 'b', userData });

          if (room.players.length === 2) {
            chessNamespace.to(roomId).emit('match_found', room);
          }
          callback({ success: true, roomState: room });
        } else {
          callback({ success: false, message: 'Room is full' });
        }
      } else {
        callback({ success: false, message: 'Room not found' });
      }
    });

    // Handle game actions (piece move)
    socket.on('game_action', (data) => {
      const { roomId, actionType, payload } = data;
      socket.to(roomId).emit('game_action', { actionType, payload });
    });

    // Handle player forfeiting
    socket.on('forfeit_game', ({ roomId }) => {
      const room = rooms.get(roomId);
      if (!room) return;

      const forfeitingPlayer = room.players.find(p => p.id === socket.id);
      const remainingPlayers = room.players.filter(p => p.id !== socket.id);

      if (forfeitingPlayer && remainingPlayers.length > 0) {
        console.log(`Chess Player ${socket.id} forfeited room ${roomId}`);
        chessNamespace.to(roomId).emit('player_forfeited', {
          forfeitedPlayerId: forfeitingPlayer.id,
          winnerPlayerId: remainingPlayers[0].id,
        });
        rooms.delete(roomId);
      }
    });

    socket.on('disconnect', () => {
      console.log(`Chess Socket disconnected: ${socket.id}`);
      
      removeFromAllQueues(socket.id);

      for (const [roomId, room] of rooms.entries()) {
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== -1) {
          chessNamespace.to(roomId).emit('player_disconnected', {
            id: socket.id,
          });
          rooms.delete(roomId);
          break;
        }
      }
    });
  });

  return chessNamespace;
}

module.exports = initChessSocket;
