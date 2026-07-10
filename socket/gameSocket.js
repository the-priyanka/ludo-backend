const { Server } = require('socket.io');

function initSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: '*', // Adjust this for production
      methods: ['GET', 'POST'],
    },
  });

  const matchQueue = [];
  const rooms = new Map();

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('join_matchmaking', (data) => {
      // Very basic matchmaking for 2 players
      matchQueue.push({ socket, data });
      if (matchQueue.length >= 2) {
        const player1 = matchQueue.shift();
        const player2 = matchQueue.shift();

        const roomId = `room_${Date.now()}`;
        player1.socket.join(roomId);
        player2.socket.join(roomId);

        const roomState = {
          roomId,
          players: [
            { id: player1.socket.id, playerNo: 1 },
            { id: player2.socket.id, playerNo: 2 }
          ],
          activePlayersList: [1, 2] // Assuming 2 player mode for now
        };
        rooms.set(roomId, roomState);

        // Notify players
        io.to(roomId).emit('match_found', roomState);
      }
    });

    // Create private room
    socket.on('create_room', (data, callback) => {
      const roomId = `room_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      socket.join(roomId);
      const roomState = {
        roomId,
        players: [{ id: socket.id, playerNo: 1 }],
        activePlayersList: [1, 2] // Defaults to 2 player for private room in MVP
      };
      rooms.set(roomId, roomState);
      callback({ success: true, roomId, roomState });
    });

    // Join private room
    socket.on('join_room', (roomId, callback) => {
      const room = rooms.get(roomId);
      if (room) {
        if (room.players.length < 2) { // Allow up to 2 for now, can extend to 4
          const playerNo = room.players.length + 1;
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
      const qIndex = matchQueue.findIndex(p => p.socket.id === socket.id);
      if (qIndex !== -1) {
        matchQueue.splice(qIndex, 1);
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
