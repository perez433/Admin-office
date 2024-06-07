const express = require('express');
const app = express();
const port = 3000;

app.use(express.json());

const clients = {};
let adminClient = null;

function addClientToDatabase(clientId) {
  // Simulate adding client to the database
  console.log(`Client ${clientId} added to the database`);
}

function removeClientFromDatabase(clientId) {
  // Simulate removing client from the database
  console.log(`Client ${clientId} removed from the database`);
}

function getClientData(callback) {
  // Simulate fetching client data from the database
  const clientList = Object.keys(clients).map(clientId => ({
    clientId,
    name: `Client ${clientId}`,
    inputs: [] // Add dummy inputs for now
  }));
  callback(clientList);
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