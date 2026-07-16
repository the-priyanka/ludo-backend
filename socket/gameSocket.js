const { Server } = require('socket.io');

function initSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: '*', // Adjust this for production
      methods: ['GET', 'POST'],
    },
  });

  const matchQueue2p = [];
  const matchQueue4p = [];
  const rooms = new Map();

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('join_matchmaking', (data) => {
      const { playerCount, userData } = data; // playerCount is 2 or 4
      
      if (playerCount === 4) {
        matchQueue4p.push({ socket, userData });
        if (matchQueue4p.length >= 4) {
          const players = [];
          const roomId = `room_${Date.now()}`;
          for (let i = 1; i <= 4; i++) {
            const p = matchQueue4p.shift();
            p.socket.join(roomId);
            players.push({ id: p.socket.id, playerNo: i, userData: p.userData });
          }

          const roomState = {
            roomId,
            players,
            activePlayersList: [1, 2, 3, 4]
          };
          rooms.set(roomId, roomState);
          io.to(roomId).emit('match_found', roomState);
        }
      } else {
        // Default to 2 players
        matchQueue2p.push({ socket, userData });
        if (matchQueue2p.length >= 2) {
          const p1 = matchQueue2p.shift();
          const p2 = matchQueue2p.shift();

          const roomId = `room_${Date.now()}`;
          p1.socket.join(roomId);
          p2.socket.join(roomId);

          const roomState = {
            roomId,
            players: [
              { id: p1.socket.id, playerNo: 1, userData: p1.userData },
              { id: p2.socket.id, playerNo: 3, userData: p2.userData } // Player 1 (Red) vs Player 3 (Yellow)
            ],
            activePlayersList: [1, 3]
          };
          rooms.set(roomId, roomState);
          io.to(roomId).emit('match_found', roomState);
        }
      }
    });

    socket.on('leave_matchmaking', () => {
      const q2Index = matchQueue2p.findIndex(p => p.socket.id === socket.id);
      if (q2Index !== -1) matchQueue2p.splice(q2Index, 1);
      
      const q4Index = matchQueue4p.findIndex(p => p.socket.id === socket.id);
      if (q4Index !== -1) matchQueue4p.splice(q4Index, 1);
    });

    // Create private room
    socket.on('create_room', (data, callback) => {
      const roomId = `room_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      socket.join(roomId);
      const roomState = {
        roomId,
        players: [{ id: socket.id, playerNo: 1 }],
        activePlayersList: [1, 3] // Player 1 (Red) vs Player 3 (Yellow), consistent with quick match
      };
      rooms.set(roomId, roomState);
      callback({ success: true, roomId, roomState });
    });

    // Join private room
    socket.on('join_room', (roomId, callback) => {
      const room = rooms.get(roomId);
      if (room) {
        if (room.players.length < 2) { // Allow up to 2 for now, can extend to 4
          // Assign playerNo 3 (Yellow) as the second player in 2-player private room
          const playerNo = 3;
          socket.join(roomId);
          room.players.push({ id: socket.id, playerNo });
          
          if (room.players.length === 2) { // Start game when 2 players join
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

    // Handle generic game actions (dice roll, piece move)
    socket.on('game_action', (data) => {
      // Broadcast to everyone else in the room
      const { roomId, actionType, payload } = data;
      socket.to(roomId).emit('game_action', { actionType, payload });
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
      // Remove from queue if in matchmaking
      const q2Index = matchQueue2p.findIndex(p => p.socket.id === socket.id);
      if (q2Index !== -1) {
        matchQueue2p.splice(q2Index, 1);
      }
      const q4Index = matchQueue4p.findIndex(p => p.socket.id === socket.id);
      if (q4Index !== -1) {
        matchQueue4p.splice(q4Index, 1);
      }

      // If in a room, notify other players (forfeit)
      for (const [roomId, room] of rooms.entries()) {
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== -1) {
          io.to(roomId).emit('player_disconnected', { id: socket.id, playerNo: room.players[playerIndex].playerNo });
          rooms.delete(roomId); // Simple cleanup
        }
      }
    });
  });

  return io;
}

module.exports = initSocket;
