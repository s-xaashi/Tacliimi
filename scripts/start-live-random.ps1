param(
    [int]$TimeoutSeconds = 5
)

# Find a free TCP port by binding to port 0
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ($listener.LocalEndpoint).Port
$listener.Stop()

Write-Output "Selected free port: $port"

# Build the live-server command
$liveCmd = "npx live-server --port=$port"
Write-Output "Starting Live Server: $liveCmd"

# Start a new Powershell window and run live-server so the current shell stays usable
Start-Process powershell -ArgumentList "-NoExit","-Command",$liveCmd

# Exit this script
return 0
