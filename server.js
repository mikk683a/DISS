const express = require("express");
const session = require("express-session");
const http = require("https");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
var crypto = require("crypto");
const https = require('https');
const fs = require('fs');
const app = express();
app.use(express.static(__dirname + "/public"));
app.use(express.static(__dirname + "/socket.io"));

// Read the TLS certificate and key from the file system
const options = {
  key: fs.readFileSync('server.key'),
  cert: fs.readFileSync('server.crt'),
  rejectUnathorized: false,
};

// Use the body-parser middleware to parse incoming requests
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Use the express-session middleware to manage sessions
app.use(
  session({
    secret: 'Tys Tys',
    name: 'uniqueSessionID',
    saveUninitialized: false,
    resave: false,
  }),
);

// Create an HTTPS server
const server = https.createServer(options, app);

// Start listening on port 3000
server.listen(3000, () => {
  console.log('Server started on port 3000');
});


//--------SQLITE OG DATABASE QUERIEES-------//

const db = new sqlite3.Database("./db.sqlite");

db.serialize(function () {
  console.log("creating database if they don't exist");
  db.run(
    "create table if not exists users (id integer primary key, username text not null, password text not null, timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);"
  );
  db.run(
    "create table if not exists chat (id integer primary key, username text not null, message text not null, timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);"
  );
});

// Tilføjer user til db `message: {username, password, timestamp}`
const addUserToDatabase = (username, password) => {
  db.run(
    "insert into users (username, password) values (?, ?)",
    [username, password],
    function (err) {
      if (err) {
        console.error(err);
      }
    }
  );
};

const addMessageToDatabase = (username, message) => {
  db.run(
    "insert into chat (username, message) values (?, ?)",
    [username, message],
    function (err) {
      if (err) {
        console.error(err);
      }
    }
  );
};

const getChatMessages = () => {
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT * FROM chat",
      (err, rows) => {
        if (err) {
          console.error(err);
          return reject(err);
        }
        return resolve(rows);
      }
    );
  });
}

// Funktioner
const hashPassword = (password) => {
  const md5sum = crypto.createHash("md5");
  const salt = "Some salt for the hash";
  return md5sum.update(password + salt).digest("hex");
};

// Endpoints:

// Sørger for at henvise til den rette side
app.get("/", function (req, res) {
  if (req.session.loggedIn) {
    return res.redirect("/dashboard");
  } else {
    return res.sendFile("/signup/login.html", {
      root: path.join(__dirname, "public"),
    });
  }
});

app.get("/chat", async (req, res) => {
  const storedChat = await getChatMessages();
  res.json(storedChat);
});

// Hjemmeskærmen
app.get("/dashboard", function (req, res) {
  res.sendFile(__dirname + "/public/chat.html");
});

// Login verifikation
app.post("/authenticate", bodyParser.urlencoded(), async (req, res) => {
  // Henter vi brugeren ud fra databasen
  const user = await getUserByUsername(req.body.username);
  console.log({
    user,
  });
  console.log({
    reqBody: req.body,
  });

  if (user.length === 0) {
    console.log("no user found");
    return res.redirect("/");
  }

  const password = hashPassword(req.body.password);
  if (user[0].password == password) {
    req.session.loggedIn = true;
    req.session.username = req.body.username;
    res.redirect("/");
  } else {
    // Sender en error 401 (unauthorized) til klienten
    return res.sendStatus(401);
  }
});

const getUserByUsername = (username) => {
  // Smart måde at konvertere fra callback til promise:
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT * FROM users WHERE username = (?)",
      [username],
      (err, rows) => {
        if (err) {
          console.error(err);
          return reject(err);
        }
        return resolve(rows);
      }
    );
  });
};

app.get("/signup", (req, res) => {
  if (req.session.loggedIn) {
    return res.redirect("/dashboard");
  } else {
    res.sendFile(__dirname + "/public/signup/signup.html");
  }
});


app.post(
  "/signup",
  bodyParser.urlencoded({
    extended: false
  }),
  async (req, res) => {
    // Check that the username and password are both non-empty strings
    if (!req.body.username || !req.body.password) {
      // Send an error response if either the username or password is missing
      res.status(400).send({
        error: "Missing username or password",
        redirect: "/signup",
      });

      return;
    }

    // Check if the username is already in use
    const user = await getUserByUsername(req.body.username);
    if (user.length > 0) {
      // Send an error response if the username is already in use
      res.status(400).send({
        error: "Username is already in use",
        redirect: "/signup",
      });
      return;
    }

    // Hash the password and add the user to the database
    const passwordHash = hashPassword(req.body.password);
    addUserToDatabase(req.body.username, passwordHash);

    // Redirect to the homepage
    res.redirect("/");
  }
);

app.get("/logout", (req, res) => {
  req.session.destroy((err) => {});
  return res.redirect("/");
});

////________ SOCKET.IO _____________________________________________

const io = require("socket.io")(server); 

// serves files from the "public" directory using the express.static middleware
app.use(express.static(path.join(__dirname+"/public"))); 

io.on("connection", function(socket){ // lytter efter en ny socket connection
	socket.on("newuser",function(username){ // lytter efter et "newuser" event, som emittes når en user connecter
		// sender en "update" event, om at en ny user er joined, til alle connectede klienter, undtaget den som selv emittede "newuser" eventet.
		socket.broadcast.emit("update", username + " sluttede sig til samtalen"); 
	});
	socket.on("exituser",function(username){ // listens for an "exituser" event, which is emitted when a user disconnects
		socket.broadcast.emit("update", username + " sluttede sig til samtalen"); // sends an "update" event to all connected clients, except the one that emitted the "exituser" event, with the message that the user has left the conversation
	});
  socket.on("chat", function (message) { // listens for a "chat" event, which is emitted when a user sends a message
    const { username, text } = message;
    addMessageToDatabase(username, text);
		socket.broadcast.emit("chat", message); // sends a "chat" event to all connected clients, except the one that emitted the "chat" event, with the message that was sent
	});
});


module.exports = app;
