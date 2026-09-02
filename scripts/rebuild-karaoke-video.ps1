# rebuild-karaoke-video.ps1
#
# Refaz o vídeo de karaokê (.mp4) de UMA música já gerada, usando os tempos
# ATUAIS do song_data.json daquela pasta. Não roda IA nenhuma.
#
# PARA QUE SERVE: a tela de Revisão de Alinhamento salva as correções no
# song_data.json e reescreve o .txt - mas não mexe no .mp4, que fica com os
# tempos antigos. Este script aplica as correções ao vídeo em segundos, em vez
# de reprocessar a música inteira (Demucs + WhisperX) por causa de um ajuste.
#
# COMO USAR (três formas, todas equivalentes):
#   1. Arraste a PASTA da música para cima deste arquivo no Explorador.
#   2. Clique com o botão direito -> "Executar com o PowerShell" e cole o
#      caminho da pasta quando ele pedir.
#   3. Pelo terminal:  .\rebuild-karaoke-video.ps1 -SongDir "C:\Karaoke\Artista - Titulo"
#
# O app instalado tem o mesmo código; este script existe para quem quer rodar
# sem esperar uma versão nova do instalador.

param([string]$SongDir)

$ErrorActionPreference = "Stop"

function Fail($msg) { Write-Host "" ; Write-Host "ERRO: $msg" -ForegroundColor Red ; Write-Host "" ; Read-Host "Enter para fechar" ; exit 1 }

if (-not $SongDir) {
    $SongDir = Read-Host "Cole o caminho da pasta da musica (a que tem o song_data.json)"
}
# Aspas coladas junto ao caminho são o erro mais comum de quem copia do
# Explorador - tirar aqui evita uma falha boba e confusa.
$SongDir = $SongDir.Trim().Trim('"')

if (-not (Test-Path -LiteralPath $SongDir -PathType Container)) {
    Fail "Nao achei a pasta: $SongDir"
}
if (-not (Test-Path -LiteralPath (Join-Path $SongDir "song_data.json"))) {
    Fail @"
Essa pasta nao tem song_data.json, entao nao da pra refazer o video
(esse arquivo e quem guarda os tempos das silabas).

Se voce marcou "manter apenas o essencial" na geracao, ele foi apagado -
nesse caso a musica precisa ser gerada de novo.
"@
}

# O Python do ambiente de IA do USKMaker: e ele que tem as bibliotecas.
$venvPython = Join-Path $env:LOCALAPPDATA "USKMaker\venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $venvPython)) {
    Fail "Nao achei o Python do USKMaker em $venvPython. Rode 'Configurar ambiente de IA' no app primeiro."
}

# O ffmpeg EMBUTIDO. Fora do app a variavel nao vem definida, e o modulo cairia
# no "ffmpeg" do PATH - que a maioria das maquinas nao tem, porque o ponto do
# ffmpeg embutido e justamente nao exigir isso.
$bundledFfmpeg = Join-Path $env:LOCALAPPDATA "USKMaker\bin\ffmpeg.exe"
if (Test-Path -LiteralPath $bundledFfmpeg) { $env:USKMAKER_FFMPEG = $bundledFfmpeg }

# O codigo do sidecar: preferir o que esta ao lado deste script (pasta do
# repositorio / instalacao), e so entao a copia instalada.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$candidates = @(
    (Join-Path (Split-Path -Parent $scriptDir) "python-sidecar"),
    (Join-Path $scriptDir "python-sidecar"),
    (Join-Path ${env:ProgramFiles} "USKMaker\_up_\python-sidecar")
)
$codeDir = $candidates | Where-Object { Test-Path -LiteralPath (Join-Path $_ "pipeline\video_export.py") } | Select-Object -First 1
if (-not $codeDir) { Fail "Nao achei o codigo do sidecar (pipeline\video_export.py)." }

Write-Host ""
Write-Host "Refazendo o video de karaoke..." -ForegroundColor Cyan
Write-Host "  musica : $SongDir"
Write-Host "  codigo : $codeDir"
Write-Host ""

Push-Location $codeDir
try {
    & $venvPython -m pipeline.video_export --dir $SongDir
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}

Write-Host ""
if ($code -eq 0) {
    Write-Host "Pronto. O .mp4 da pasta foi refeito com os tempos atuais." -ForegroundColor Green
} else {
    Write-Host "Falhou (codigo $code). A mensagem acima diz o motivo." -ForegroundColor Red
}
Write-Host ""
Read-Host "Enter para fechar" | Out-Null
