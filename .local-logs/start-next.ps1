$env:NEXT_PUBLIC_ENGINE_URL='http://127.0.0.1:8002'
$env:ENGINE_URL='http://127.0.0.1:8002'
Set-Location 'C:\Users\koish\OneDrive\Рабочий стол\job projects\plana\mvp\plana'
npm.cmd run dev -- --hostname 127.0.0.1 *> .local-logs\next-dev.combined.log
