const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const WORDS = ["pizza","playa","doctor","guitarra","avion","cafe","perro","pelicula"];

let games = {};

function randomWord(){
  return WORDS[Math.floor(Math.random()*WORDS.length)];
}

function aliveIds(g){
  return Object.entries(g.players).filter(([_,p])=>p.alive).map(([id])=>id);
}

function broadcastPlayers(room){
  const g = games[room];
  io.to(room).emit("players",
    Object.entries(g.players).map(([id,p])=>({
      id,
      name:p.name,
      alive:p.alive
    }))
  );
}

function broadcastMissingVotes(room){
  const g = games[room];
  const missing = aliveIds(g).filter(id => !g.votes[id])
    .map(id => g.players[id].name);

  io.to(room).emit("missingVotes",missing);
}

function checkVictory(room){
  const g = games[room];
  const alive = aliveIds(g);

  if(!alive.includes(g.impostor)){
    io.to(room).emit("victory","civiles");
    return true;
  }

  if(alive.length<=2){
    io.to(room).emit("victory","impostor");
    return true;
  }

  return false;
}

function startRound(room){
  const g = games[room];
  const ids = Object.keys(g.players);

  g.word = randomWord();
  g.impostor = ids[Math.floor(Math.random()*ids.length)];
  g.phase = "discussion";
  g.votes = {};

  ids.forEach(id => g.players[id].alive = true);

  ids.forEach(id=>{
    io.to(id).emit("role",{
      word:id===g.impostor?null:g.word,
      impostor:id===g.impostor
    });
  });

  broadcastPlayers(room);
  io.to(room).emit("phase","discussion");
}

function startVoting(room){
  const g = games[room];
  g.phase="voting";
  g.votes={};

  broadcastPlayers(room);
  broadcastMissingVotes(room);

  io.to(room).emit("phase","voting");
}

function finishVoting(room){
  const g = games[room];
  let tally={};

  Object.values(g.votes).forEach(v=>{
    tally[v]=(tally[v]||0)+1;
  });

  let max=0,elim=null;
  for(let id in tally){
    if(tally[id]>max){
      max=tally[id];
      elim=id;
    }
  }

  if(elim){
    g.players[elim].alive=false;
    io.to(room).emit("result",{
      name:g.players[elim].name,
      wasImpostor: elim===g.impostor
    });
  }

  broadcastPlayers(room);

  if(checkVictory(room)) return;

  g.phase="discussion";
  io.to(room).emit("phase","discussion");
}

io.on("connection",socket=>{

  socket.on("create",()=>{
    const room=Math.random().toString(36).substring(2,6).toUpperCase();
    games[room]={players:{}};
    socket.join(room);
    socket.emit("room",room);
  });

  socket.on("join",({room,name})=>{
    const g=games[room];
    if(!g) return;

    g.players[socket.id]={name,alive:true};
    socket.join(room);

    broadcastPlayers(room);
  });

  socket.on("startRound",room=>startRound(room));
  socket.on("startVoting",room=>startVoting(room));

  socket.on("vote",({room,target})=>{
    const g=games[room];
    if(!g) return;

    const player=g.players[socket.id];
    if(!player || !player.alive) return;

    g.votes[socket.id]=target;

    broadcastMissingVotes(room);

    if(Object.keys(g.votes).length===aliveIds(g).length){
      finishVoting(room);
    }
  });

});

server.listen(process.env.PORT||3000,()=>console.log("Servidor listo"));
