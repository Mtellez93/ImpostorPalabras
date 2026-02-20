const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const WORDS = ["pizza","playa","doctor","guitarra","avion","cafe","perro"];

let games = {};

function randomWord() {
  return WORDS[Math.floor(Math.random()*WORDS.length)];
}

io.on("connection", socket => {

  socket.on("create", () => {
    const room = Math.random().toString(36).substring(2,6).toUpperCase();

    games[room] = {
      players: {},
      word: null,
      impostor: null,
      alive: []
    };

    socket.join(room);
    socket.emit("room", room);
  });

  socket.on("join", ({room,name}) => {
    const game = games[room];
    if(!game) return;

    game.players[socket.id] = { name };
    socket.join(room);

    io.to(room).emit("players", Object.values(game.players));
  });

  socket.on("start", room => {
    const game = games[room];
    if(!game) return;

    game.word = randomWord();
    const ids = Object.keys(game.players);
    game.impostor = ids[Math.floor(Math.random()*ids.length)];
    game.alive = ids;

    ids.forEach(id => {
      io.to(id).emit("role", {
        word: id === game.impostor ? null : game.word,
        impostor: id === game.impostor
      });
    });

    io.to(room).emit("started");
  });

});

server.listen(process.env.PORT || 3000, () =>
  console.log("Servidor listo")
);
