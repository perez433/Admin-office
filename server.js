const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();

const app = express();
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

let clients = {};
let clientEvents = {};

app.get('/events', (req, res) => {
  const clientId = req.query.clientId;

  // Check if the clientId is valid
  if (clientId) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (!clients[clientId]) {
      addClientToDatabase(clientId);
      clients[clientId] = res;
    }

    req.on('close', () => {
    	//delete client on connection close
      delete clients[clientId];
      removeClientFromDatabase(clientId);
      broadcastAdminPanel();
    });

    broadcastAdminPanel();
  } else {
    // Respond with an error for invalid clientIds
    res.status(400).send('Invalid clientId');
  }
});

app.post('/delete-client', (req, res) => {
  const { clientId } = req.body;
  if (clientId) {
    // Remove the client from memory and database
    if (clients[clientId]) {
      clients[clientId].end(); // End the SSE connection
      delete clients[clientId];
    }
    removeClientFromDatabase(clientId);
    broadcastAdminPanel();
    res.sendStatus(200);
  } else {
    res.status(400).send('Missing clientId');
  }
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
  const { clientId, inputName, inputValue } = req.body;
  
  console.log(req.body);

  if (!clientId || !inputName || !inputValue) {
    return res.status(400).send('Missing clientId, inputName, or inputValue');
  }

  // Check if the client already exists in the database
  db.get("SELECT id FROM clients WHERE id = ?", [clientId], (err, row) => {
    if (!row) {
      // If client doesn't exist, add it to the database
      addClientToDatabase(clientId);
    }

    // Update client inputs in the database
    db.get("SELECT inputs FROM clients WHERE id = ?", [clientId], (err, row) => {
      const inputs = JSON.parse(row.inputs);
      inputs.push({ label: inputName, value: inputValue });
      updateClientInputs(clientId, inputs);
      broadcastAdminPanel();
    });
  });

  res.sendStatus(200);
});

app.listen(8080, () => {
  console.log('Server is listening on port 8080');
});