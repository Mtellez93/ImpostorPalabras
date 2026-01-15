const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Configuración de EJS y archivos estáticos
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

// URL de tu Google Sheet en formato CSV (Publicado en la web)
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS3ew0A8dyAgQ97TjsFXqBIjm86T8500zPPdB9iut5dWpE-NPzf9MAN3z01whnkwAMNUME-y1xcH-IT/pub?output=csv";

let rooms = {};

// Función para obtener una palabra aleatoria del banco de palabras
async function getRandomWord() {
    try {
        const response = await axios.get(SHEET_URL);
        const rows = response.data.split('\r\n'); // Separar por líneas
        const words = rows.filter(word => word.trim() !== ""); // Limpiar vacíos
        return words[Math.floor(Math.random() * words.length)];
    } catch (error) {
        console.error("Error leyendo Google Sheets:", error);
        return "Palabra Error"; // Fallback
    }
}

// Rutas
app.get('/', (req, res) => res.render('index'));

// Lógica de Sockets
io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

    // 1. Crear Sala (Host)
    socket.on('createRoom', () => {
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        rooms[roomCode] = {
            host: socket.id,
            players: [],
            status: 'lobby', // lobby, playing, voting
            word: '',
            impostorId: null
        };
        socket.join(roomCode);
        socket.emit('roomCreated', roomCode);
    });

    // 2. Unirse a Sala (Jugador)
    socket.on('joinRoom', ({ code, name }) => {
        const room = rooms[code.toUpperCase()];
        if (room && room.status === 'lobby') {
            const newPlayer = {
                id: socket.id,
                name: name,
                isAlive: true,
                votesReceived: 0
            };
            room.players.push(newPlayer);
            socket.join(code.toUpperCase());
            
            socket.emit('joined');
            // Notificar al host para actualizar lista
            io.to(room.host).emit('updatePlayers', room.players);
        } else {
            socket.emit('errorMsg', 'Sala no encontrada o ya inició');
        }
    });

    // 3. Empezar Juego
    socket.on('startGame', async (code) => {
        const room = rooms[code];
        if (!room) return;

        const selectedWord = await getRandomWord();
        room.word = selectedWord;
        room.status = 'playing';

        // Elegir impostor al azar
        const impostorIndex = Math.floor(Math.random() * room.players.length);
        room.impostorId = room.players[impostorIndex].id;

        // Enviar palabra a cada uno
        room.players.forEach(player => {
            if (player.id === room.impostorId) {
                io.to(player.id).emit('receiveRole', { role: 'impostor', msg: 'Eres el Impostor' });
            } else {
                io.to(player.id).emit('receiveRole', { role: 'civil', msg: room.word });
            }
        });

        io.to(room.host).emit('gameStarted');
    });

    // 4. Iniciar Votación
    socket.on('startVote', (code) => {
        const room = rooms[code];
        if (room) {
            room.status = 'voting';
            const alivePlayers = room.players.filter(p => p.isAlive);
            io.to(code).emit('votingStarted', alivePlayers);
        }
    });

    // 5. Procesar Voto
    socket.on('castVote', ({ code, targetId }) => {
        const room = rooms[code];
        if (!room) return;

        const target = room.players.find(p => p.id === targetId);
        if (target) target.votesReceived++;

        // Aquí podrías añadir lógica para saber cuando todos votaron
        // Por simplicidad, el Host puede cerrar la votación
    });

    socket.on('disconnect', () => {
        console.log('Usuario desconectado');
    });
});

server.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
