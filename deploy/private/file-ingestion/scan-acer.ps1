$ErrorActionPreference = 'Stop'
$python = "$env:LOCALAPPDATA\Programs\Python\Python314\python.exe"
$bundle = "$env:LOCALAPPDATA\arra-files"
$state = "$env:LOCALAPPDATA\arra-files-state"
$whisper = "$env:LOCALAPPDATA\arra-whisper\Scripts\whisper.exe"
if (!(Test-Path $whisper)) { $whisper = "$env:APPDATA\Python\Python314\Scripts\whisper.exe" }
if ((Test-Path $whisper) -and (Test-Path "$env:LOCALAPPDATA\arra-whisper\READY")) {
  $env:ARRA_WHISPER_BIN = $whisper
  $env:ARRA_WHISPER_MODEL = 'small'
}
& $python "$bundle\collector.py" --root "$env:USERPROFILE" --device acer --volume D49F48BE --state "$state\c" --limit 25 --transport-key "$env:USERPROFILE\.ssh\id_ed25519_arra_files_acer" --transport-target poramateake@100.109.242.66 --known-hosts "$env:USERPROFILE\.ssh\known_hosts"
& $python "$bundle\collector.py" --root "D:\" --device acer --volume 2421EE03 --state "$state\d" --limit 25 --transport-key "$env:USERPROFILE\.ssh\id_ed25519_arra_files_acer" --transport-target poramateake@100.109.242.66 --known-hosts "$env:USERPROFILE\.ssh\known_hosts"
