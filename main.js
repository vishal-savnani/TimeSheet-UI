// main.js - extended version with migrations, comments, approvals, admin actions
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const initSqlJs = require("sql.js");

let db;

async function loadDB() {
  const SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, "sql-wasm.wasm")
  });

  const dbPath = path.join(__dirname, "timesheet.db");

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
    initializeTables();
    saveDB();
  }

  runMigrations();
}

function saveDB() {
  const buffer = Buffer.from(db.export());
  fs.writeFileSync(path.join(__dirname, "timesheet.db"), buffer);
}

function initializeTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      role TEXT,
      company_id INTEGER,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS timesheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      date TEXT,
      task TEXT,
      start_time TEXT,
      end_time TEXT,
      break_minutes INTEGER,
      billable INTEGER,
      rate_per_hour REAL,
      billable_amount REAL,
      company_id INTEGER,
      status TEXT DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timesheet_id INTEGER,
      user_id INTEGER,
      commenter_role TEXT,
      comment TEXT,
      created_at TEXT
    );
  `);

  const hash = bcrypt.hashSync("Admin@123", 10);

  const rows = all(`SELECT id FROM users WHERE username = ?`, ["admin"]);
  if (!rows.length) {
    db.run(
      `INSERT INTO users (username, password, role, active) VALUES (?, ?, 'admin', 1);`,
      ["admin", hash]
    );
  }
  saveDB();
}

function runMigrations() {
  try { db.run(`ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1;`); } catch {}
  try { db.run(`ALTER TABLE timesheets ADD COLUMN status TEXT DEFAULT 'pending';`); } catch {}
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timesheet_id INTEGER,
        user_id INTEGER,
        commenter_role TEXT,
        comment TEXT,
        created_at TEXT
      );
    `);
  } catch {}

  saveDB();
}

function all(sql, params = []) {
  const stmt = db.prepare(sql, params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function run(sql, params = []) {
  const stmt = db.prepare(sql, params);
  stmt.step();
  stmt.free();
  saveDB();
  return { success: true };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1300,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile("login.html");
}

app.whenReady().then(async () => {
  await loadDB();
  createWindow();
});

/* AUTH */
ipcMain.handle("auth:login", (event, { username, password }) => {
  const rows = all(`SELECT * FROM users WHERE username = ?`, [username]);
  if (!rows.length) return { success: false, message: "User not found" };

  const user = rows[0];

  if (!user.active && user.role !== "admin")
    return { success: false, message: "User is deactivated" };

  if (!bcrypt.compareSync(password, user.password))
    return { success: false, message: "Incorrect password" };

  delete user.password;
  return { success: true, user };
});

ipcMain.handle("user:changePassword", (event, { userId, oldPassword, newPassword }) => {
  const rows = all(`SELECT * FROM users WHERE id = ?`, [userId]);
  if (!rows.length) return { success: false, message: "User not found" };

  const user = rows[0];
  if (!bcrypt.compareSync(oldPassword, user.password))
    return { success: false, message: "Old password incorrect" };

  const hash = bcrypt.hashSync(newPassword, 10);
  run(`UPDATE users SET password = ? WHERE id = ?`, [hash, userId]);

  return { success: true };
});

/* ADMIN USERS */
ipcMain.handle("admin:createUser", (event, { username, password, role, company_id }) => {
  try {
    const hash = bcrypt.hashSync(password, 10);
    run(
      `INSERT INTO users (username, password, role, company_id, active) VALUES (?,?,?,?,1)`,
      [username, hash, role, company_id || null]
    );
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

ipcMain.handle("admin:getUsers", () => {
  return all(`
    SELECT u.*, c.company_name 
    FROM users u LEFT JOIN companies c ON c.id = u.company_id
    ORDER BY u.id DESC
  `);
});

ipcMain.handle("admin:resetPassword", (event, { userId, newPassword }) => {
  try {
    const hash = bcrypt.hashSync(newPassword, 10);
    run(`UPDATE users SET password = ? WHERE id = ?`, [hash, userId]);
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

ipcMain.handle("admin:editUser", (event, { userId, username, role, company_id, active }) => {
  try {
    run(
      `UPDATE users SET username=?, role=?, company_id=?, active=? WHERE id=?`,
      [username, role, company_id || null, active ? 1 : 0, userId]
    );
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

ipcMain.handle("admin:deleteUser", (event, { userId }) => {
  try {
    run(`DELETE FROM users WHERE id=?`, [userId]);
    run(`DELETE FROM timesheets WHERE user_id=?`, [userId]);
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

/* COMPANIES */
ipcMain.handle("company:list", () => {
  return all(`SELECT * FROM companies ORDER BY company_name ASC`);
});

ipcMain.handle("company:create", (event, { name }) => {
  try {
    run(`INSERT INTO companies (company_name) VALUES (?)`, [name]);
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

/* TIMESHEETS */
ipcMain.handle("timesheet:add", (event, entry) => {
  try {
    run(
      `INSERT INTO timesheets 
       (user_id,date,task,start_time,end_time,break_minutes,billable,rate_per_hour,billable_amount,company_id,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        entry.user_id,
        entry.date,
        entry.task,
        entry.start_time,
        entry.end_time,
        entry.break_minutes,
        entry.billable,
        entry.rate_per_hour,
        entry.billable_amount,
        entry.company_id,
        entry.status || "pending"
      ]
    );
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

ipcMain.handle("timesheet:getByUser", (event, userId) => {
  return all(
    `SELECT t.*, c.company_name
     FROM timesheets t 
     LEFT JOIN companies c ON c.id = t.company_id
     WHERE t.user_id = ?
     ORDER BY date DESC`,
    [userId]
  );
});

ipcMain.handle("timesheet:getAll", () => {
  return all(
    `SELECT t.*, u.username, c.company_name
     FROM timesheets t 
     LEFT JOIN users u ON u.id = t.user_id
     LEFT JOIN companies c ON c.id = t.company_id
     ORDER BY date DESC`
  );
});

ipcMain.handle("timesheet:update", (event, entry) => {
  try {
    run(
      `UPDATE timesheets SET 
       date=?, task=?, start_time=?, end_time=?, break_minutes=?, billable=?, 
       rate_per_hour=?, billable_amount=?, company_id=?, status=? 
       WHERE id=?`,
      [
        entry.date,
        entry.task,
        entry.start_time,
        entry.end_time,
        entry.break_minutes,
        entry.billable,
        entry.rate_per_hour,
        entry.billable_amount,
        entry.company_id,
        entry.status || "pending",
        entry.id
      ]
    );
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

ipcMain.handle("timesheet:delete", (event, { id }) => {
  try {
    run(`DELETE FROM timesheets WHERE id = ?`, [id]);
    run(`DELETE FROM comments WHERE timesheet_id = ?`, [id]);
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

ipcMain.handle("timesheet:approve", (event, { id, action, adminId, note }) => {
  try {
    const status = action === "approve" ? "approved" : "rejected";
    run(`UPDATE timesheets SET status = ? WHERE id = ?`, [status, id]);

    if (note && note.trim()) {
      const now = new Date().toISOString();
      run(
        `INSERT INTO comments (timesheet_id, user_id, commenter_role, comment, created_at)
         VALUES (?,?,?,?,?)`,
        [id, adminId, "admin", note.trim(), now]
      );
    }

    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

/* COMMENTS */
ipcMain.handle("comment:add", (event, { timesheet_id, user_id, commenter_role, comment }) => {
  try {
    const now = new Date().toISOString();
    run(
      `INSERT INTO comments (timesheet_id, user_id, commenter_role, comment, created_at)
       VALUES (?,?,?,?,?)`,
      [timesheet_id, user_id, commenter_role, comment, now]
    );
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

ipcMain.handle("comment:getByTimesheet", (event, timesheetId) => {
  return all(
    `SELECT c.*, u.username 
     FROM comments c 
     LEFT JOIN users u ON u.id = c.user_id
     WHERE c.timesheet_id = ?
     ORDER BY c.created_at ASC`,
    [timesheetId]
  );
});

/* REPORTS */
ipcMain.handle("report:totals", () => {
  const totalUsers = all("SELECT COUNT(*) as c FROM users")[0].c;
  const totalCompanies = all("SELECT COUNT(*) as c FROM companies")[0].c;
  const totalEntries = all("SELECT COUNT(*) as c FROM timesheets")[0].c;

  const monthStart = new Date();
  monthStart.setDate(1);
  const mISO = monthStart.toISOString().split("T")[0];

  const rows = all(
    "SELECT start_time, end_time, break_minutes FROM timesheets WHERE date >= ?",
    [mISO]
  );

  let minutes = 0;
  rows.forEach(r => {
    try {
      const sh = parseInt(r.start_time.split(":")[0]);
      const sm = parseInt(r.start_time.split(":")[1]);
      const eh = parseInt(r.end_time.split(":")[0]);
      const em = parseInt(r.end_time.split(":")[1]);
      const s = sh * 60 + sm;
      const e = eh * 60 + em;
      const w = e - s - (Number(r.break_minutes) || 0);
      if (w > 0) minutes += w;
    } catch {}
  });

  const workedHours = Math.round((minutes / 60) * 100) / 100;

  const totalAmount =
    all("SELECT SUM(billable_amount) as s FROM timesheets")[0].s || 0;

  return {
    totalUsers,
    totalCompanies,
    totalEntries,
    totalHoursThisMonth: workedHours,
    billableAmount: totalAmount
  };
});

process.on("unhandledRejection", err => {
  console.error("Unhandled Rejection:", err);
});
