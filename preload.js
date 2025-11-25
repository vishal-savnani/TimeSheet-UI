// preload.js — exposes all IPC handlers to renderer (admin/operator)
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  /* -------------------------
     AUTH
  ------------------------- */
  login: (creds) => ipcRenderer.invoke("auth:login", creds),
  userChangePassword: (payload) =>
    ipcRenderer.invoke("user:changePassword", payload),

  /* -------------------------
     ADMIN USERS
  ------------------------- */
  adminCreateUser: (payload) =>
    ipcRenderer.invoke("admin:createUser", payload),

  adminGetUsers: () => ipcRenderer.invoke("admin:getUsers"),

  adminResetPassword: (payload) =>
    ipcRenderer.invoke("admin:resetPassword", payload),

  adminEditUser: (payload) =>
    ipcRenderer.invoke("admin:editUser", payload),

  adminDeleteUser: (payload) =>
    ipcRenderer.invoke("admin:deleteUser", payload),

  /* -------------------------
     COMPANIES
  ------------------------- */
  companyList: () => ipcRenderer.invoke("company:list"),

  companyCreate: (payload) =>
    ipcRenderer.invoke("company:create", payload),

  /* -------------------------
     TIMESHEETS CRUD
  ------------------------- */
  timesheetAdd: (entry) =>
    ipcRenderer.invoke("timesheet:add", entry),

  timesheetGetByUser: (userId) =>
    ipcRenderer.invoke("timesheet:getByUser", userId),

  timesheetGetAll: () => ipcRenderer.invoke("timesheet:getAll"),

  timesheetUpdate: (entry) =>
    ipcRenderer.invoke("timesheet:update", entry),

  timesheetDelete: (payload) =>
    ipcRenderer.invoke("timesheet:delete", payload),

  timesheetApprove: (payload) =>
    ipcRenderer.invoke("timesheet:approve", payload),

  /* -------------------------
     COMMENTS
  ------------------------- */
  commentAdd: (payload) =>
    ipcRenderer.invoke("comment:add", payload),

  commentGetByTimesheet: (tsId) =>
    ipcRenderer.invoke("comment:getByTimesheet", tsId),

  /* -------------------------
     REPORTS FOR DASHBOARD
  ------------------------- */
  reportTotals: () => ipcRenderer.invoke("report:totals"),
});
