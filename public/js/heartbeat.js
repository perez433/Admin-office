// Send heartbeat signals to the server at regular intervals
const heartbeatInterval = setInterval(() => {
    fetch('/heartbeat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            clientId: clientId,
            currPage: currPage
        }),
    })
    .then(response => {
    	
    	
        if (!response.ok) {
            throw new Error('Failed to send heartbeat signal to server');
        }
    })
    .catch(error => {
        console.error('Error sending heartbeat signal to server:', error);
    });
}, 29000); 