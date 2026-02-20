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

function broadcastPlayers(room){
  const g = games[room];
  io.to(room).emit("players",
    Object.entries(g.players).map(([id,p])=>({
      id,
      name:p.name
    }))
  );
}

function startRound(room){
  const g = games[room];

  const ids = Object.keys(g.players);
  g.word = randomWord();
  g.impostor = ids[Math.floor(Math.random()*ids.length)];
  g.votes = {};
  g.phase = "discussion";

  ids.forEach(id=>{
    io.to(id).emit("role",{
      word: id===g.impostor ? null : g.word,
      impostor: id===g.impostor
    });
  });

  io.to(room).emit("phase","discussion");
}

function startVoting(room){
  const g = games[room];
  g.phase = "voting";
  g.votes = {};

  io.to(room).emit("phase","voting");
  broadcastPlayers(room);
  updateVoteStatus(room);
}

function updateVoteStatus(room){
  const g = games[room];
  const voted = Object.keys(g.votes);
  const total = Object.keys(g.players).length;

  io.to(room).emit("voteStatus",{ votedCount:voted.length, total });
}

function finishVoting(room){
  const g = games[room];
  let tally = {};

  Object.values(g.votes).forEach(v=>{
    tally[v]=(tally[v]||0)+1;
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
      name:g.players[eliminated].name,
      wasImpostor: eliminated===g.impostor
    });
  } else {
    io.to(room).emit("result",{name:"Nadie",wasImpostor:false});
  }

  g.phase="discussion";
}

io.on("connection",socket=>{

  socket.on("create",()=>{
    const room=Math.random().toString(36).substring(2,6).toUpperCase();
    games[room]={players:{},phase:"lobby"};
    socket.join(room);
    socket.emit("room",room);
  });

  socket.on("join",({room,name})=>{
    const g=games[room];
    if(!g) return;

    g.players[socket.id]={name};
    socket.join(room);

    broadcastPlayers(room);
  });

  socket.on("startRound",room=>startRound(room));

  socket.on("startVoting",room=>startVoting(room));

  socket.on("vote",({room,target})=>{
    const g=games[room];
    if(!g) return;

    g.votes[socket.id]=target;
    updateVoteStatus(room);

    if(Object.keys(g.votes).length===Object.keys(g.players).length){
      finishVoting(room);
    }
  });

});
server.listen(process.env.PORT||3000,()=>console.log("Fiesta Pro listo"));
