@echo off
chcp 65001 >nul
title TELA LIVE - nao feche esta janela
cd /d "%~dp0"
color 0B

cls
echo ==============================================
echo               TELA LIVE
echo ==============================================
echo.

:: ---- 1. Node instalado? ----
where node >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Node.js nao encontrado no PATH.
    echo        Instale em https://nodejs.org e rode de novo.
    echo.
    pause
    exit /b
)

:: ---- 2. Dependencias ----
if not exist "node_modules\express\" (
    echo [*] Instalando dependencias, espera um pouco...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERRO] npm install falhou. Leia a mensagem acima.
        pause
        exit /b
    )
)

:: ---- 3. Abre a porta 3000 no firewall ----
netsh advfirewall firewall show rule name="Tela Live 3000" >nul 2>&1
if errorlevel 1 (
    echo [*] Tentando abrir a porta 3000 no firewall...
    netsh advfirewall firewall add rule name="Tela Live 3000" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
    if errorlevel 1 (
        echo     Sem admin, o Windows pode bloquear acesso de fora.
        echo     Se os amigos nao conseguirem entrar, rode como admin uma vez:
        echo     netsh advfirewall firewall add rule name="Tela Live 3000" dir=in action=allow protocol=TCP localport=3000
    ) else (
        echo     Porta 3000 liberada.
    )
) else (
    echo [OK] Porta 3000 ja liberada no firewall.
)

:: ---- 4. Enderecos ----
echo.
echo ==============================================
echo    ENDERECOS PARA MANDAR PROS AMIGOS:
echo.
powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } | ForEach-Object { Write-Host ('      http://' + $_.IPAddress + ':3000') -ForegroundColor Yellow }"
echo      http://localhost:3000   ^(so nesta maquina^)
echo ==============================================
echo    Feche esta janela OU aperte Ctrl+C para parar.
echo ==============================================
echo.

:: ---- 5. Libera uma instancia anterior do Tela Live ----
powershell -NoProfile -ExecutionPolicy Bypass -Command "$conexoes = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; foreach ($conexao in $conexoes) { $processo = Get-Process -Id $conexao.OwningProcess -ErrorAction SilentlyContinue; if ($processo -and $processo.ProcessName -eq 'node') { Stop-Process -Id $processo.Id -Force -ErrorAction SilentlyContinue } }"
timeout /t 1 /nobreak >nul

:: ---- 6. Sobe o servidor (fica rodando aqui) ----
node server.js

echo.
echo [!] Servidor caiu. Mensagem acima.
pause
