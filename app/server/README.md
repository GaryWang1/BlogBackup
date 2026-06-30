# Blog Backup Tool — Server

This folder contains the local server for the Blog Backup Tool.

Development (auto-reload with nodemon)

1. Open PowerShell in this folder:

```powershell
cd "c:\Users\075426\Desktop\Blog Backup\BlogBackup\app\server"
```

2. Install dependencies (adds `nodemon` from devDependencies):

```powershell
npm install
```

3. Start the server in development mode (prevents auto-opening the browser):

```powershell
$env:BLOG_BACKUP_NO_OPEN='1'
npm run dev
```

This uses `nodemon` to watch the `src` folder and restart the server automatically when you edit files.

Notes

- If port 3000 is already in use, either stop that process or start on a different port:

```powershell
$env:BLOG_BACKUP_PORT=3001
npm run dev
```

- To run without `nodemon`, use `npm start`.

Production / persistent runner (optional)

- Install `pm2` globally and start the server as a managed process:

```powershell
npm install -g pm2
pm2 start server.js --name blog-backup --watch
pm2 save
```

- On Windows you can also configure a Task Scheduler entry or use `pm2-windows-startup`.

Logs

- Server logs are written to `..\..\logs\server-YYYY-MM-DD.log` (relative to this folder).

Troubleshooting

- If the UI is already running and you see `Blog Backup Tool is already running at http://localhost:3000`, either stop the running process or launch the new instance on a different port.
- To kill the process using port 3000 in PowerShell:

```powershell
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```
