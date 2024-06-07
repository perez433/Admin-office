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
	console.log(`Client ${clientId} added to the database`);
  }

function removeClientFromDatabase(clientId) {
  db.run("DELETE FROM clients WHERE id = ?", [clientId]);
  console.log(`Client ${clientId} removed from the database`);
  }

function updateClientInputs(clientId, inputs) {
  db.run("UPDATE clients SET inputs = ? WHERE id = ?", [JSON.stringify(inputs), clientId]);
}

function getClientData(callback) {
  db.all("SELECT * FROM clients", (err, rows) => {
    callback(rows.map(row => ({ clientId: row.id, inputs: JSON.parse(row.inputs) })));
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

  console.log(`Received /events request: clientId=${clientId}, isAdmin=${isAdmin}`);

  if (clientId || isAdmin) {
  	console.log('isAdmin pass');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (clientId && !clients[clientId]) {
      addClientToDatabase(clientId);
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
  	console.log('is Admin failed');
    res.status(400).send('Invalid clientId or admin query parameter');
  }
});

app.post('/input', (req, res) => {
  const { clientId, inputName, inputValue } = req.body;

  console.log('Received /input request:', req.body);

  if (!clientId || !inputName || !inputValue) {
    return res.status(400).send('Missing clientId, inputName, or inputValue');
  }

  // Check if the client already exists in the database
  db.get("SELECT id FROM clients WHERE id = ?", [clientId], (err, row) => {
    if (!row) {
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

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
}); 