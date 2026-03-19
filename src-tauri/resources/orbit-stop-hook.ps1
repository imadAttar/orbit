$input_data = [Console]::In.ReadToEnd()
$trigger = Join-Path $env:USERPROFILE ".orbit" "score-request.json"
[System.IO.File]::WriteAllText($trigger, $input_data)
