/**
 * Electron 主进程：给单文件游戏套一个原生窗口。
 *
 * 游戏本身是纯网页，不需要任何 Node 能力，所以这里把 Node 集成全关掉：
 * nodeIntegration: false + contextIsolation: true + sandbox: true。
 * 主进程只做三件事——开窗口、加载 HTML、把外链丢给系统浏览器。
 */
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');

/** 游戏在 web/ 目录下，打包进 asar 后相对路径依然成立。 */
const GAME_HTML = path.join(__dirname, '..', '..', 'web', '股市模拟.html');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    // 游戏本身适配到 360px 宽，窗口也就允许缩到这么窄
    minWidth: 360,
    minHeight: 600,
    // 与游戏大厅底色一致，避免启动瞬间闪白
    backgroundColor: '#e7ebf0',
    title: '股市模拟',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });

  // 先渲染完再显示，避免看到空白窗口
  win.once('ready-to-show', () => win.show());

  win.loadFile(GAME_HTML);

  // 游戏里的外链（例如图表库署名）交给系统浏览器，不在应用里开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 游戏不需要菜单栏，这里手动补上 F11 全屏
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });

  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
