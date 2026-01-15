const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS3ew0A8dyAgQ97TjsFXqBIjm86T8500zPPdB9iut5dWpE-NPzf9MAN3z01whnkwAMNUME-y1xcH-IT/pub?output=csv";

let rooms = {};

async function getRandomWord() {
    try {
        const response = await axios.get(SHEET_URL);
        const rows = response.data.split(/\r?\n/);
        const words = rows.map(r => r.trim()).filter(r => r !== "");
        return words[Math.floor(Math.random() * words.length)];
    } catch (error) {
        return "Pizza"; 
    }
}

// RUTAS
app.get('/', (req, res) => res.render('index'));
app.get('/host', (req, res) => res.render('host'));
app.get('/game', (req, res) => res.render('game'));

io.on('connection', (socket) => {
    socket.on('createRoom', () => {
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        rooms[roomCode] = { host: socket.id, players: [], status: 'lobby', word: '', impostorId: null, votesCast: 0 };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
    });

    socket.on('joinRoom', ({ code, name }) => {
        const roomCode = code.toUpperCase();
        const room = rooms[roomCode];
        if (room && room.status === 'lobby') {
            const newPlayer = { id: socket.id, name, isAlive: true, votesReceived: 0 };
            room.players.push(newPlayer);
            socket.join(roomCode);
            socket.emit('joined');
            io.to(room.host).emit('updatePlayers', room.players);
        } else {
            socket.emit('errorMsg', 'Sala no encontrada');
        }
    });

    socket.on('startGame', async (code) => {
        const room = rooms[code.toUpperCase()];
        if (!room) return;
        room.word = await getRandomWord();
        room.status = 'playing';
        const impostorIndex = Math.floor(Math.random() * room.players.length);
        room.impostorId = room.players[impostorIndex].id;

        room.players.forEach(p => {
            const roleData = (p.id === room.impostorId) ? { role: 'impostor', msg: 'Eres el Impostor' } : { role: 'civil', msg: room.word };
            io.to(p.id).emit('receiveRole', roleData);
        });
        io.to(room.host).emit('gameStarted', { word: room.word });
    });

    socket.on('startVote', (code) => {
        const room = rooms[code.toUpperCase()];
        if (room) {
            room.status = 'voting';
            room.votesCast = 0;
            const alivePlayers = room.players.filter(p => p.isAlive);
            io.to(code.toUpperCase()).emit('votingStarted', alivePlayers);
        }
    });

    socket.on('castVote', ({ code, targetId }) => {
        const room = rooms[code.toUpperCase()];
        if (!room) return;
        const target = room.players.find(p => p.id === targetId);
        if (target) { target.votesReceived++; room.votesCast++; }

        const aliveCount = room.players.filter(p => p.isAlive).length;
        if (room.votesCast >= aliveCount) {
            const sorted = [...room.players].sort((a, b) => b.votesReceived - a.votesReceived);
            const eliminated = sorted[0];
            eliminated.isAlive = false;
            let resultMsg = `${eliminated.name} fue expulsado. `;
            let gameOver = false;
            if (eliminated.id === room.impostorId) { resultMsg += "¡Era el Impostor! Civiles ganan."; gameOver = true; }
            else if (room.players.filter(p => p.isAlive).length <= 2) { resultMsg += "¡El Impostor gana!"; gameOver = true; }
            io.to(code.toUpperCase()).emit('votingResult', { msg: resultMsg, gameOver });
        }
    });
});

server.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
