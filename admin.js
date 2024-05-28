// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

console.log(server.address());

app.use(express.static('public'));
app.use(bodyParser.json());

// Initialize SQLite database
const db = new sqlite3.Database(':memory:');

db.serialize(() => {
  db.run("CREATE TABLE clients (id TEXT PRIMARY KEY, inputs TEXT)");
});

function addClientToDatabase(clientId) {
  db.run("INSERT INTO clients (id, inputs) VALUES (?, ?)", [clientId, JSON.stringify([])]);
}

function removeClientFromDatabase(clientId) {
  db.run("DELETE FROM clients WHERE id = ?", [clientId]);
}

function updateClientInputs(clientId, inputs) {
  db.run("UPDATE clients SET inputs = ? WHERE id = ?", [JSON.stringify(inputs), clientId]);
}

function getClientData(callback) {
  db.all("SELECT * FROM clients", (err, rows) => {
    callback(rows.map(row => ({ clientId: row.id, inputs: JSON.parse(row.inputs) })));
  });
}

wss.on('connection', (ws) => {
  const clientId = Date.now().toString(); // Use timestamp as a simple client ID
  addClientToDatabase(clientId);

  ws.on('message', (message) => {
    const data = JSON.parse(message);
    if (data.type === 'input') {
      db.get("SELECT inputs FROM clients WHERE id = ?", [clientId], (err, row) => {
        const inputs = JSON.parse(row.inputs);
        inputs.push(data.input);
        updateClientInputs(clientId, inputs);
        broadcastAdminPanel();
      });
    }
  });

  ws.on('close', () => {
    removeClientFromDatabase(clientId);
    broadcastAdminPanel();
  });

  broadcastAdminPanel();
});

function broadcastAdminPanel() {
  getClientData((clientList) => {
    const message = JSON.stringify({ type: 'adminUpdate', clientList });
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });
}

app.post('/send-command', (req, res) => {
  const { clientId, command } = req.body;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'command', command }));
    }
  });
  res.sendStatus(200);
});

app.post('/delete-client', (req, res) => {
  const { clientId } = req.body;
  removeClientFromDatabase(clientId);
  broadcastAdminPanel();
  res.sendStatus(200);
});

server.listen(8080, () => {
  console.log('Server is listening on port 8080');
}); 
