const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const WORDS = [
  "pizza","playa","doctor","guitarra",
  "avion","cafe","perro","pelicula"
];

let games = {};

function randomWord(){
  return WORDS[Math.floor(Math.random()*WORDS.length)];
}

function startRound(room){
  const game = games[room];

  const ids = Object.keys(game.players);
  game.word = randomWord();
  game.impostor = ids[Math.floor(Math.random()*ids.length)];
  game.votes = {};
  game.phase = "discussion";

  ids.forEach(id=>{
    io.to(id).emit("role",{
      word: id===game.impostor ? null : game.word,
      impostor: id===game.impostor
    });
  });

  io.to(room).emit("phase","discussion");
}

function finishVoting(room){
  const game = games[room];

  let tally = {};

  Object.values(game.votes).forEach(v=>{
    tally[v] = (tally[v]||0)+1;
  });

  let max=0;
  let eliminated=null;

  for(let id in tally){
    if(tally[id]>max){
      max=tally[id];
      eliminated=id;
    }
  }

  if(eliminated){
    io.to(room).emit("result",{
      name: game.players[eliminated].name,
      wasImpostor: eliminated===game.impostor
    });
  } else {
    io.to(room).emit("result",{name:"Nadie",wasImpostor:false});
  }

  game.phase="discussion";
}

io.on("connection",socket=>{

  socket.on("create",()=>{
    const room=Math.random().toString(36).substring(2,6).toUpperCase();

    games[room]={
      players:{},
      phase:"lobby"
    };

    socket.join(room);
    socket.emit("room",room);
  });

  socket.on("join",({room,name})=>{
    const game=games[room];
    if(!game) return;

    game.players[socket.id]={name};
    socket.join(room);

    io.to(room).emit("players",Object.values(game.players));
  });

  socket.on("start",room=>{
    startRound(room);
  });

  socket.on("startVoting",room=>{
    const game=games[room];
    if(!game) return;

    game.votes={};
    game.phase="voting";

    io.to(room).emit("phase","voting");
    io.to(room).emit("playerList",game.players);
  });

  socket.on("vote",({room,target})=>{
    const game=games[room];
    if(!game) return;

    game.votes[socket.id]=target;

    if(Object.keys(game.votes).length===Object.keys(game.players).length){
      finishVoting(room);
    }
  });

});

server.listen(process.env.PORT||3000,()=>{
  console.log("Servidor listo");
});
