import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
// import { availableParallelism } from 'node:os';
import cluster from 'node:cluster';
import { createAdapter, setupPrimary } from '@socket.io/cluster-adapter';
import dotenv from 'dotenv';
import path from 'path'
import { cpus } from 'os';

const availableParallelism = () => cpus().length;

dotenv.config()
console.log(process.env.MONGO_DB, 'Load test');
if (cluster.isPrimary) {
  const numCPUs = availableParallelism();
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork({
      PORT: 3000 + i
    });
  }

  setupPrimary();
} else {
  await mongoose.connect(process.env.MONGO_DB?? 'mongodb://localhost:27017/chatdb').then(()=>{
    console.log('Data base connected' );
  });

  const messageSchema = new mongoose.Schema({
    client_offset: { type: String, unique: true },
    content: String
  });

  const Message = mongoose.model('Message', messageSchema);

  const app = express();
  const server = createServer(app);
  const io = new Server(server, {
    connectionStateRecovery: {},
    adapter: createAdapter()
  });

  
  const __dirname = dirname(fileURLToPath(import.meta.url));
  
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
  });
  app.get('/test', (req, res) => {
    res.sendFile(join(__dirname, 'indexCopy.html'));
  });
  app.post('/clearChat', async (req, res) => {
    await Message.deleteMany().then((result) => {
      if (result) {
        console.log("DB Cleared"); 
        res.json({ success: true });      } else {
        res.status(500).send("Error occurred while clearing chat."); // Sending an error response if something went wrong
      }
    }).catch((error) => {
      console.error("Error occurred while clearing chat:", error);
      res.status(500).send("Error occurred while clearing chat."); // Sending an error response if something went wrong
    });
  });
  
  io.on('connection', async (socket) => {
    socket.on('chat message', async (msg, clientOffset, callback) => {
      let result;
      try {
        const newMessage = new Message({ content: msg, client_offset: clientOffset });
        result = await newMessage.save();
      } catch (e) {
        if (e.code === 11000 /* MongoDB duplicate key error */) {
          callback();
        } else {
          // nothing to do, just let the client retry
        }
        return;
      }
      io.emit('chat message', msg, result._id);
      callback();
    });

    if (!socket.recovered) {
      try {
        const messages = await Message.find({}).sort({ _id: 1 }).exec();
        messages.forEach((row) => {
          socket.emit('chat message', row.content, row._id);
        });
      } catch (e) {
        // something went wrong
      }
    }
  });

  const port = process.env.PORT;

  server.listen(port, () => {
    console.log(`server running at http://localhost:${port}`);
  });
}
