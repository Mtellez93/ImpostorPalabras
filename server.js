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
  "avion","cafe","perro","pelicula","Star Wars", "Porno", "IA", "Internet","Africa","Futbol","Imaginacion","Amistad","Odio","Anime","Disneyland","shampoo","Tejido","Gigantes","Mentiras","Verdad","Aventuras","Navidad","Pokemon","MarioBros","California","Mexico"
];

let games = {};
const PLAYER_GRACE_MS = 5 * 60 * 1000;

function randomWord(){
  return WORDS[Math.floor(Math.random()*WORDS.length)];
}

function aliveIds(g){
  return Object.entries(g.players)
    .filter(([_,p])=>p.alive)
    .map(([id])=>id);
}

function broadcastPlayers(room){
  const g = games[room];
  if(!g) return;

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
  if(!g || !g.votes) return;

  const missing = aliveIds(g)
    .filter(id => !g.votes[id])
    .map(id => g.players[id].name);

  io.to(room).emit("missingVotes",missing);
}

function broadcastVoteCounts(room){
  const g = games[room];
  if(!g || !g.votes) return;

  let counts = {};

  Object.entries(g.players).forEach(([id,p])=>{
    if(p.alive) counts[p.name]=0;
  });

  Object.values(g.votes).forEach(target=>{
    const name = g.players[target].name;
    if(counts[name] !== undefined){
      counts[name]++;
    }
  });

  io.to(room).emit("voteCounts", counts);
}

function checkVictory(room){
  const g = games[room];
  if(!g) return false;

  const alive = aliveIds(g);

  if(!alive.includes(g.impostor)){
    io.to(room).emit("victory","civiles");
    return true;
  }

  if(alive.length <= 2){
    io.to(room).emit("victory","impostor");
    return true;
  }

  return false;
}

function startRound(room){
  const g = games[room];
  if(!g) return;

  const ids = Object.keys(g.players);
  if(ids.length < 3){
    io.to(room).emit("errorMessage","Se necesitan al menos 3 jugadores.");
    return;
  }

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
  if(!g) return;

  g.phase="voting";
  g.votes={};

  broadcastPlayers(room);
  broadcastVoteCounts(room);
  broadcastMissingVotes(room);

  io.to(room).emit("phase","voting");
}

function finishVoting(room){
  const g = games[room];
  if(!g) return;

  let tally = {};

  Object.values(g.votes).forEach(v=>{
    tally[v]=(tally[v]||0)+1;
  });

  let max = 0;
  let elim = null;
  let tie = false;

  for(let id in tally){
    if(tally[id] > max){
      max = tally[id];
      elim = id;
      tie = false;
    } else if(tally[id] === max){
      tie = true;
    }
  }

  if(tie || !elim){
    io.to(room).emit("result",{tie:true});
    g.phase="discussion";
    io.to(room).emit("phase","discussion");
    return;
  }

  g.players[elim].alive = false;

  io.to(room).emit("result",{
    name:g.players[elim].name,
    wasImpostor: elim===g.impostor
  });

  broadcastPlayers(room);

  if(checkVictory(room)) return;

  g.phase="discussion";
  io.to(room).emit("phase","discussion");
}

function roomOfSocket(socket){
  return [...socket.rooms].find(r => r !== socket.id);
}

function attachSocketToPlayer(room, playerId, socket){
  const g = games[room];
  if(!g || !g.players[playerId]) return false;

  g.players[playerId].socketId = socket.id;
  if(g.players[playerId].disconnectTimer){
    clearTimeout(g.players[playerId].disconnectTimer);
    g.players[playerId].disconnectTimer = null;
  }

  socket.join(room);
  socket.data.room = room;
  socket.data.playerId = playerId;
  return true;
}

function removePlayer(room, playerId){
  const g = games[room];
  if(!g || !g.players[playerId]) return;

  const wasImpostor = g.impostor === playerId;
  delete g.players[playerId];
  if(g.votes){
    delete g.votes[playerId];
  }
  if(g.impostor && !g.players[g.impostor]){
    g.impostor = null;
  }

  broadcastPlayers(room);
  if(g.phase === "voting"){
    broadcastVoteCounts(room);
    broadcastMissingVotes(room);
  }

  if(wasImpostor && g.phase){
    io.to(room).emit("errorMessage","El impostor salió de la partida. Reinicien ronda.");
    g.phase = null;
  }
}

io.on("connection",socket=>{

  socket.on("create",()=>{
    const room=Math.random().toString(36).substring(2,6).toUpperCase();
    games[room]={players:{}, phase:null, votes:{}};
    socket.join(room);
    socket.data.room = room;
    socket.emit("room",room);
  });

  socket.on("join",({room,name,playerId})=>{
    const g=games[room];
    if(!g){
      socket.emit("errorMessage","No existe esa sala.");
      return;
    }

    const cleanName = (name || "").trim();
    if(!cleanName){
      socket.emit("errorMessage","Ingresa un nombre válido.");
      return;
    }

    if(playerId && g.players[playerId]){
      g.players[playerId].name = cleanName;
      attachSocketToPlayer(room, playerId, socket);
      socket.emit("joined",{room,playerId,name:cleanName,reconnected:true});
      if(g.phase){
        socket.emit("phase",g.phase);
      }
    } else {
      const newPlayerId = Math.random().toString(36).slice(2,10);
      g.players[newPlayerId]={
        name:cleanName,
        alive:true,
        socketId:socket.id,
        disconnectTimer:null
      };
      attachSocketToPlayer(room, newPlayerId, socket);
      socket.emit("joined",{room,playerId:newPlayerId,name:cleanName,reconnected:false});
      if(g.phase){
        socket.emit("phase",g.phase);
      }
      if(g.impostor){
        socket.emit("role",{
          word:newPlayerId===g.impostor?null:g.word,
          impostor:newPlayerId===g.impostor
        });
      }
    }
    broadcastPlayers(room);
  });

  socket.on("startRound",room=>startRound(room));
  socket.on("startVoting",room=>startVoting(room));

  socket.on("vote",({room,target})=>{
    const g=games[room];
    if(!g) return;

    const playerId = socket.data.playerId;
    const player=g.players[playerId];
    if(!player || !player.alive) return;
    if(!g.players[target] || !g.players[target].alive) return;

    g.votes[playerId]=target;

    broadcastVoteCounts(room);
    broadcastMissingVotes(room);

    if(Object.keys(g.votes).length===aliveIds(g).length){
      finishVoting(room);
    }
  });

  socket.on("disconnect",()=>{
    const room = socket.data.room || roomOfSocket(socket);
    const playerId = socket.data.playerId;
    if(!room || !playerId) return;

    const g = games[room];
    if(!g || !g.players[playerId]) return;
    if(g.players[playerId].socketId !== socket.id) return;

    g.players[playerId].disconnectTimer = setTimeout(()=>{
      removePlayer(room, playerId);
    }, PLAYER_GRACE_MS);
  });

});

server.listen(process.env.PORT||3000,()=>{
  console.log("Servidor listo");
});
