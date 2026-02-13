import { app, BrowserWindow, globalShortcut, ipcMain, clipboard } from 'electron';
import path from 'path';
import { spawn } from 'child_process';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
    app.quit();
}

// Enable WebGPU with NVIDIA GPU (using D3D12 backend for Windows)
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('enable-features', 'Vulkan,UseSkiaRenderer');
app.commandLine.appendSwitch('use-angle', 'd3d11'); // Use D3D11 for ANGLE
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds');

let mainWindow: BrowserWindow | null = null;
const RECORD_SHORTCUT = 'Shift+Z';

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 400,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        frame: false, // Frameless for a modern look
        titleBarStyle: 'hidden',
        transparent: true,
        alwaysOnTop: true, // Start on top, but changes on focus
        skipTaskbar: false,
        focusable: true,
    });

    // Toggle alwaysOnTop based on focus
    mainWindow.on('blur', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setAlwaysOnTop(false);
        }
    });

    mainWindow.on('focus', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setAlwaysOnTop(true);
        }
    });

    // In production, load the local index.html.
    // In development, load the vite dev server URL.
    const isDev = !app.isPackaged;
    const startUrl = isDev
        ? 'http://localhost:3002'
        : `file://${path.join(__dirname, '../../dist/index.html')}`;

    mainWindow.loadURL(startUrl);

    if (isDev) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// IPC handlers for window controls
ipcMain.on('window-minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.minimize();
    }
});

ipcMain.on('window-close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
    }
});

function registerShortcuts() {
    const ret = globalShortcut.register(RECORD_SHORTCUT, () => {
        console.log(`${RECORD_SHORTCUT} is pressed`);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('toggle-recording');
            // Do NOT call mainWindow.show() here - it steals focus from the active text field
            // The recording happens in the background, user's cursor stays in their app
        }
    });

    if (!ret) {
        console.log('registration failed');
    }
}

app.whenReady().then(() => {
    createWindow();
    registerShortcuts();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

// simulateActivePaste: Writes text to clipboard and simulates Ctrl+V
ipcMain.on('transcription-complete', async (event, text) => {
    console.log('Received transcription:', text);
    if (!text) return;

    // 1. Write transcription to clipboard
    // Ideally user wants this to remain in clipboard for manual pasting if needed
    clipboard.writeText(text);

    // 2. Simulate paste via PowerShell (Ctrl+V)
    // Using -NoProfile for speed/security
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait("^v")
    `;

    const ps = spawn('powershell', ['-NoProfile', '-Command', script]);

    ps.on('error', (err) => {
        console.error('Failed to run powershell script:', err);
    });

    ps.stderr.on('data', (data) => {
        console.error(`PS error: ${data}`);
    });
});
