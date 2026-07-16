const { Server } = require('socket.io');

function initSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: '*', // Adjust this for production
      methods: ['GET', 'POST'],
    },
  });

  // Key format: "playerCount_entryFee"  e.g. "2_1000" or "4_5000"
  // Only players with the SAME playerCount AND entryFee will be matched.
  const matchQueues = new Map(); // Map<queueKey, Array<{ socket, userData, entryFee }>>
  const rooms = new Map();

  // Helper: get or create a queue for a given key
  function getQueue(key) {
    if (!matchQueues.has(key)) {
      matchQueues.set(key, []);
    }
    return matchQueues.get(key);
  }

  // Helper: remove a socket from ALL queues (used on leave / disconnect)
  function removeFromAllQueues(socketId) {
    for (const [key, queue] of matchQueues.entries()) {
      const idx = queue.findIndex(p => p.socket.id === socketId);
      if (idx !== -1) {
        queue.splice(idx, 1);
        // Clean up empty queues
        if (queue.length === 0) matchQueues.delete(key);
        break;
      }
    }
  }

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('join_matchmaking', (data) => {
      const { playerCount, entryFee = 0, userData } = data;

      // Build a unique queue key: both player count AND entry fee must match
      const queueKey = `${playerCount}_${entryFee}`;
      const queue = getQueue(queueKey);

      // Add this player to the queue
      queue.push({ socket, userData, entryFee });
      console.log(`Player ${socket.id} joined queue [${queueKey}], queue size: ${queue.length}`);

      // Check if we have enough players to start a match
      if (queue.length >= playerCount) {
        const players = [];
        const roomId = `room_${Date.now()}`;

        // Take the required number of players from the front of the queue
        for (let i = 0; i < playerCount; i++) {
          const p = queue.shift();
          p.socket.join(roomId);

          // Assign player numbers based on position
          // 2-player: Player 1 (Red) vs Player 3 (Yellow)
          // 4-player: Player 1, 2, 3, 4
          let playerNo;
          if (playerCount === 2) {
            playerNo = i === 0 ? 1 : 3;
          } else {
            playerNo = i + 1;
          }

          players.push({ id: p.socket.id, playerNo, userData: p.userData });
        }

        // Clean up empty queue
        if (queue.length === 0) matchQueues.delete(queueKey);

        const activePlayersList = playerCount === 2 ? [1, 3] : [1, 2, 3, 4];

        const roomState = {
          roomId,
          players,
          activePlayersList,
          entryFee, // include entryFee in roomState for client use
        };

        rooms.set(roomId, roomState);
        io.to(roomId).emit('match_found', roomState);
        console.log(`Match found for queue [${queueKey}], roomId: ${roomId}`);
      }
    });

    socket.on('leave_matchmaking', () => {
      removeFromAllQueues(socket.id);
      console.log(`Player ${socket.id} left matchmaking`);
    });

    // Create private room
    socket.on('create_room', (data, callback) => {
      const roomId = `room_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      socket.join(roomId);
      const roomState = {
        roomId,
        players: [{ id: socket.id, playerNo: 1, userData: data }],
        activePlayersList: [1, 3], // Player 1 (Red) vs Player 3 (Yellow)
        entryFee: 0,
      };
      rooms.set(roomId, roomState);
      callback({ success: true, roomId, roomState });
    });

    // Join private room
    socket.on('join_room', (roomId, callback) => {
      const room = rooms.get(roomId);
      if (room) {
        if (room.players.length < 2) {
          // Assign playerNo 3 (Yellow) as the second player
          const playerNo = 3;
          socket.join(roomId);
          room.players.push({ id: socket.id, playerNo });

          if (room.players.length === 2) {
            io.to(roomId).emit('match_found', room);
          }
          callback({ success: true });
        } else {
          callback({ success: false, message: 'Room is full' });
        }
      } else {
        callback({ success: false, message: 'Room not found' });
      }
    });

    // Handle player forfeiting (leaving mid-game)
    socket.on('forfeit_game', ({ roomId }) => {
      const room = rooms.get(roomId);
      if (!room) return;

      // Find the forfeiting player and remaining opponent(s)
      const forfeitingPlayer = room.players.find(p => p.id === socket.id);
      const remainingPlayers = room.players.filter(p => p.id !== socket.id);

      if (forfeitingPlayer && remainingPlayers.length > 0) {
        console.log(`Player ${socket.id} (P${forfeitingPlayer.playerNo}) forfeited room ${roomId}`);
        // Tell everyone in the room who forfeited — clients will pick a winner
        io.to(roomId).emit('player_forfeited', {
          forfeitedPlayerNo: forfeitingPlayer.playerNo,
          // First remaining player is considered the winner
          winnerPlayerNo: remainingPlayers[0].playerNo,
        });
        rooms.delete(roomId);
      }
    });

    // Handle generic game actions (dice roll, piece move)
    socket.on('game_action', (data) => {
      const { roomId, actionType, payload } = data;
      socket.to(roomId).emit('game_action', { actionType, payload });
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);

      // Remove from matchmaking queues
      removeFromAllQueues(socket.id);

      // If in a room, notify other players (forfeit)
      for (const [roomId, room] of rooms.entries()) {
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== -1) {
          io.to(roomId).emit('player_disconnected', {
            id: socket.id,
            playerNo: room.players[playerIndex].playerNo,
          });
          rooms.delete(roomId); // Simple cleanup
          break;
        }
      }
    });
  });

  return io;
}

module.exports = initSocket;
