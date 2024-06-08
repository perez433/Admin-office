const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = 3000; // Define the port

app.use(express.static('public'));
app.use(bodyParser.json());

// Initialize SQLite database
const db = new sqlite3.Database(':memory:');

db.serialize(() => {
  db.run("CREATE TABLE clients (id TEXT PRIMARY KEY, inputs TEXT, ip TEXT)");
});

const clients = {}; // Initialize the clients object
let adminClient = null; // Initialize the admin client

function addClientToDatabase(clientId, ip) {
  db.run("INSERT INTO clients (id, inputs, ip) VALUES (?, ?, ?)", [clientId, JSON.stringify({}), ip], (err) => {
    if (err) {
      console.error(`Error adding client ${clientId}: ${err.message}`);
    } else {
      console.log(`Client ${clientId} with IP ${ip} added to the database`);
    }
  });
}

function removeClientFromDatabase(clientId) {
  db.run("DELETE FROM clients WHERE id = ?", [clientId], (err) => {
    if (err) {
      console.error(`Error removing client ${clientId}: ${err.message}`);
    } else {
      console.log(`Client ${clientId} removed from the database`);
    }
  });
}

function updateClientInputs(clientId, inputs) {
  db.run("UPDATE clients SET inputs = ? WHERE id = ?", [JSON.stringify(inputs), clientId], (err) => {
    if (err) {
      console.error(`Error updating inputs for client ${clientId}: ${err.message}`);
    }
  });
}

function getClientData(callback) {
  db.all("SELECT * FROM clients", (err, rows) => {
    if (err) {
      console.error(`Error retrieving client data: ${err.message}`);
      callback([]);
    } else {
      callback(rows.map(row => ({ clientId: row.id, inputs: JSON.parse(row.inputs), ip: row.ip })));
    }
  });
}

function broadcastAdminPanel() {
  getClientData((clientList) => {
    const message = JSON.stringify({ type: 'adminUpdate', clientList });
    console.log(`Broadcasting to admin panel: ${message}`);
    if (adminClient) {
      adminClient.write(`data: ${message}\n\n`);
    } else {
      console.log('No admin client connected');
    }
  });
}

app.get('/events', (req, res) => {
  const clientId = req.query.clientId;
  const isAdmin = req.query.admin === 'true';
  const clientIp = req.ip;

  console.log(`Received /events request: clientId=${clientId}, isAdmin=${isAdmin}, ip=${clientIp}`);

  if (clientId || isAdmin) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (clientId && !clients[clientId]) {
      addClientToDatabase(clientId, clientIp);
      clients[clientId] = res;
      console.log(`Client ${clientId} connected`);
    }

    if (isAdmin) {
      adminClient = res;
      console.log('Admin client connected');
    }

    req.on('close', () => {
      if (clientId) {
        delete clients[clientId];
        removeClientFromDatabase(clientId);
        console.log(`Client ${clientId} disconnected`);
      }
      if (isAdmin) {
        adminClient = null;
        console.log('Admin client disconnected');
      }
      broadcastAdminPanel();
    });

    broadcastAdminPanel();
  } else {
    res.status(400).send('Invalid clientId or admin query parameter');
  }
});

app.post('/send-command', (req, res) => {
  const { clientId, command } = req.body;
  const client = clients[clientId];
  if (client) {
    client.write(`data: ${JSON.stringify({ type: 'command', command })}\n\n`);
  }
  res.sendStatus(200);
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

app.post('/input', (req, res) => {
  const { clientId, inputs } = req.body;

  console.log('Received /input request:', req.body);

  if (!clientId || typeof inputs !== 'object') {
    return res.status(400).send('Missing clientId or inputs object');
  }

  // Check if the client already exists in the database
  db.get("SELECT id, inputs FROM clients WHERE id = ?", [clientId], (err, row) => {
    if (err) {
      console.error(`Error retrieving client ${clientId}: ${err.message}`);
      return res.sendStatus(500);
    }

    if (!row) {
      addClientToDatabase(clientId, req.ip);
      row = { inputs: '{}' };
    }

    // Merge new inputs with existing ones
    const existingInputs = JSON.parse(row.inputs);
    const updatedInputs = { ...existingInputs, ...inputs };

    updateClientInputs(clientId, updatedInputs);
    broadcastAdminPanel();

    res.sendStatus(200);
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});