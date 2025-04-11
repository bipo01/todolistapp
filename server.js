import express from "express";
import { createServer } from "http";
import pg from "pg";
import { Server } from "socket.io";
import session from "express-session";
import bodyParser from "body-parser";
import env from "dotenv";

import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

env.config();

const app = express();
const port = 3000;
const server = createServer(app);
const io = new Server(server);

const db = new pg.Client({
  connectionString: process.env.PG_URL,
});
db.connect();

// Socket.io - Real Time Data
io.on("connection", (socket) => {
  socket.on("new-task", async (data) => {
    const task = data.task;
    const deadline = data.deadline;
    const category = data.category;
    const description = data.description;
    const state = "A começar";
    const list_id = data.idList;
    const user_id = data.user_id;
    const adm_id = data.idAdmin;

    const result = await db.query(
      "INSERT INTO tasks (task,deadline,category,description,state,list_id,user_id,adm_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [task, deadline, category, description, state, list_id, user_id, adm_id]
    );
    const newTask = result.rows[0];

    io.emit("new-task", newTask);
  });

  socket.on("edit-task", async (data) => {
    const task = data.task;
    const task_id = Number(data.task_id);
    const deadline = data.deadline;
    const category = data.category;
    const description = data.description;
    const list_id = Number(data.idList);
    const user_id = Number(data.user_id);
    const adm_id = Number(data.idAdmin);

    const result = await db.query(
      "UPDATE tasks SET task = $1, deadline = $2, category = $3, description = $4, user_id = $5 WHERE id = $6 RETURNING *",
      [task, deadline, category, description, user_id, task_id]
    );
    const editedTask = result.rows[0];

    io.emit("edit-task", editedTask);
  });

  socket.on("delete-task", (task_id) => {
    db.query("DELETE FROM tasks WHERE id = $1", [task_id]);

    io.emit("delete-task", task_id);
  });

  socket.on("new-category", (data) => {
    const newCategory = data.newCategory;
    const list_id = Number(data.idList);

    db.query("UPDATE lists SET categories = categories || $1 WHERE id = $2", [
      `{${newCategory}}`,
      list_id,
    ]);

    io.emit("new-category", { newCategory, list_id });
  });

  socket.on("delete-category", (data) => {
    const list_id = data.idList;
    const categoryToRemove = data.categoryToRemove;

    db.query(
      "UPDATE lists SET categories = array_remove(categories, $1) WHERE id = $2",
      [categoryToRemove, list_id]
    );

    db.query(
      "UPDATE tasks SET category = 'Sem categoria' WHERE list_id = $1 AND category = $2",
      [list_id, categoryToRemove]
    );

    io.emit("delete-category", { categoryToRemove, list_id });
  });

  socket.on("remove-category", (data) => {
    const list_id = data.idList;
    const categoryToRemove = data.categoryToRemove;

    db.query(
      "UPDATE lists SET categories = array_remove(categories, $1) WHERE id = $2",
      [categoryToRemove, list_id]
    );

    db.query("DELETE FROM tasks WHERE list_id = $1 AND category = $2", [
      list_id,
      categoryToRemove,
    ]);

    io.emit("remove-category", { categoryToRemove, list_id });
  });

  socket.on("new-user", async (data) => {
    const username = data.newUserValue;
    const list_id = Number(data.idList);

    const newUserResult = await db.query(
      "SELECT * FROM todousers WHERE username = $1",
      [username]
    );
    const newUser = newUserResult.rows[0];
    delete newUser.password;

    db.query("UPDATE lists SET users_id = users_id || $1 WHERE id = $2", [
      `{${Number(newUser.id)}}`,
      list_id,
    ]);

    io.emit("new-user", { newUser, list_id });
  });

  socket.on("delete-user", (data) => {
    const user_id = Number(data.user_id);
    const list_id = Number(data.idList);

    db.query(
      "UPDATE lists SET users_id = array_remove(users_id, $1) WHERE id = $2",
      [user_id, list_id]
    );

    io.emit("delete-user", { user_id, list_id });
  });

  socket.on("start-task", (task_id) => {
    db.query("UPDATE tasks SET state = 'Em progresso' WHERE id = $1", [
      task_id,
    ]);

    io.emit("start-task", task_id);
  });

  socket.on("complete-task", (task_id) => {
    db.query("UPDATE tasks SET state = 'Completada' WHERE id = $1", [task_id]);

    io.emit("complete-task", task_id);
  });

  socket.on("delete-sheet", (list_id) => {
    db.query("DELETE FROM lists WHERE id = $1", [Number(list_id)]);

    io.emit("delete-sheet", list_id);
  });

  socket.on("leave-sheet", (data) => {
    const list_id = Number(data.idList);
    const user_id = Number(data.idUser);

    db.query(
      "UPDATE lists SET users_id = array_remove(users_id, $1) WHERE id = $2",
      [user_id, list_id]
    );

    io.emit("leave-sheet", { list_id, user_id });
  });

  socket.on("edit-name-sheet", (data) => {
    const list_id = Number(data.idList);
    const newName = data.newName.trim();

    db.query("UPDATE lists SET list = $1 WHERE id = $2", [newName, list_id]);

    io.emit("edit-name-sheet", { list_id, newName });
  });
});

// Middlewares
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(
  session({
    secret: process.env.EXPRESS_SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false },
  })
);

// Get Routes
app.get("/", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const myListsResult = await db.query(
    "SELECT * FROM lists WHERE users_id @> $1",
    [`{${req.session.user.id}}`]
  );
  const myLists = myListsResult.rows;

  res.render("lists.ejs", {
    user: req.session.user,
    myLists,
  });
});

app.get("/login", (req, res) => {
  res.render("login.ejs");
});

app.get("/register", (req, res) => {
  res.render("register.ejs", {
    username: req.session.registerUsername,
    password: req.session.registerPassword,
    name: req.session.registerName,
  });
});

app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.redirect("/");

    res.clearCookie("connection.sid");
    return res.redirect("/login");
  });
});

// Post Routes
app.post("/login", async (req, res) => {
  const username = req.body.username;
  const password = req.body.password;

  const result = await db.query(
    "SELECT * FROM todousers WHERE  username = $1",
    [username]
  );
  const data = result.rows[0];

  if (!data) return res.redirect("/login");

  if (!data.password == password) return res.redirect("/login");

  req.session.user = data;
  delete req.session.user.password;
  return res.redirect("/");
});

app.post("/register", async (req, res) => {
  const username = req.body.username;
  const password = req.body.password;
  const name = req.body.name;

  const checkUser = await db.query(
    "SELECT (username) FROM todousers WHERE username = $1",
    [username]
  );
  const userExists = checkUser.rows[0] || false;

  req.session.registerUsername = username;
  req.session.registerPassword = password;
  req.session.registerName = name;
  if (userExists) return res.redirect("/register");

  const result = await db.query(
    "INSERT INTO todousers (username, password, name) VALUES($1,$2,$3) RETURNING *",
    [username, password, name]
  );
  const data = result.rows[0];

  req.session.user = data;

  return res.redirect("/");
});

app.post("/new-sheet", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const newList = req.body.newList;
  const idUser = Number(req.body.idUser);

  const result = await db.query(
    "INSERT INTO lists (list, users_id, adm_id) VALUES($1,$2, $3) RETURNING *",
    [newList, [idUser], idUser]
  );
  const dataList = result.rows[0];

  res.json({ idUser, newList, dataList });
});

app.post("/home", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const idList = req.body.list;

  const tasksResults = await db.query(
    "SELECT * FROM tasks WHERE list_id = $1",
    [idList]
  );
  const tasks = tasksResults.rows;

  const listResult = await db.query("SELECT * FROM lists WHERE id = $1", [
    idList,
  ]);
  const list = listResult.rows[0];

  const allUsersId = list.users_id;

  const allUsers = [];

  for (const id of allUsersId) {
    const result = await db.query("SELECT * FROM todousers WHERE id = $1", [
      id,
    ]);
    const user = result.rows[0];

    delete user.password;

    allUsers.push(user);
  }

  res.render("home.ejs", {
    tasks,
    user: req.session.user,
    allUsers,
    list,
  });
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
