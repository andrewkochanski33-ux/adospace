const { app, BrowserWindow } = require('electron');
const path = require('path');
const { exec } = require('child_process');

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Load your Node.js server in a BrowserWindow
  win.loadURL('http://127.0.0.1:3000'); // change port if needed

  // Optional: Open DevTools
  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  // Start your Node.js server
  exec('node server.js', (err, stdout, stderr) => {
    if (err) console.error(err);
    console.log(stdout, stderr);
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
