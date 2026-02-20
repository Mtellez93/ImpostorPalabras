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

function randomWord(){
  return WORDS[Math.floor(Math.random()*WORDS.length)];
}

function startRound(room){
  const g = games[room];

  g.word = randomWord();
  const ids = Object.keys(g.players);
  g.impostor = ids[Math.floor(Math.random()*ids.length)];
  g.votes = {};
  g.phase = "discussion";

  ids.forEach(id=>{
    io.to(id).emit("role",{
      word: id===g.impostor?null:g.word,
      impostor: id===g.impostor
    });
  });

  io.to(room).emit("phase","discussion");
}

function finishVoting(room){
  const g = games[room];
  let tally={};

  Object.values(g.votes).forEach(v=>{
    tally[v]=(tally[v]||0)+1;
  });

  let max=0,elim=null;
  for(let k in tally){
    if(tally[k]>max){max=tally[k]; elim=k;}
  }

  if(elim){
    io.to(room).emit("elim", g.players[elim].name);
  } else {
    io.to(room).emit("elim","Nadie");
  }

  g.phase="discussion";
}

io.on("connection",socket=>{

  socket.on("create",()=>{
    const room=Math.random().toString(36).substring(2,6).toUpperCase();
    games[room]={players:{}, phase:"lobby"};
    socket.join(room);
    socket.emit("room",room);
  });

  socket.on("join",({room,name})=>{
    const g=games[room];
    if(!g) return;
    g.players[socket.id]={name};
    socket.join(room);
    io.to(room).emit("players",Object.values(g.players));
  });

  socket.on("start",room=>{
    startRound(room);
  });

  socket.on("startVoting",room=>{
    const g=games[room];
    g.phase="voting";
    g.votes={};

    io.to(room).emit("phase","voting");
    io.to(room).emit("playerList",g.players);
  });

  socket.on("vote",({room,target})=>{
    const g=games[room];
    g.votes[socket.id]=target;

    if(Object.keys(g.votes).length===Object.keys(g.players).length){
      finishVoting(room);
    }
  });

});

server.listen(process.env.PORT||3000);
