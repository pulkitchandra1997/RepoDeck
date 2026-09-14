param([Parameter(Mandatory)][string]$Directory)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $Directory).Path
$caKey = [System.Security.Cryptography.RSA]::Create(2048)
$serverKey = [System.Security.Cryptography.RSA]::Create(2048)
$ca = $null
$server = $null
try {
    $hash = [System.Security.Cryptography.HashAlgorithmName]::SHA256
    $padding = [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
    $caRequest = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=RepoDeck temporary test CA', $caKey, $hash, $padding)
    $caRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true, $false, 0, $true))
    $caRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign, $true))
    $now = [DateTimeOffset]::UtcNow
    $ca = $caRequest.CreateSelfSigned($now.AddMinutes(-5), $now.AddDays(1))
    $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=RepoDeck loopback fixture', $serverKey, $hash, $padding)
    $san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $san.AddIpAddress([System.Net.IPAddress]::Loopback)
    $request.CertificateExtensions.Add($san.Build())
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
    $server = $request.Create($ca, $now.AddMinutes(-1), $now.AddHours(1), [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(16))
    [System.IO.File]::WriteAllText((Join-Path $root 'ca.pem'), $ca.ExportCertificatePem())
    [System.IO.File]::WriteAllText((Join-Path $root 'server.pem'), $server.ExportCertificatePem())
    [System.IO.File]::WriteAllText((Join-Path $root 'server-key.pem'), $serverKey.ExportPkcs8PrivateKeyPem())
} finally {
    if ($server) { $server.Dispose() }
    if ($ca) { $ca.Dispose() }
    $serverKey.Dispose()
    $caKey.Dispose()
}
