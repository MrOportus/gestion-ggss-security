param (
    [Parameter(Mandatory=$true)]
    [string]$DocxPath,

    [Parameter(Mandatory=$true)]
    [string]$PdfPath
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $DocxPath)) {
    Write-Error "Archivo DOCX no encontrado: $DocxPath"
    exit 1
}

$fullDocx = [System.IO.Path]::GetFullPath($DocxPath)
$fullPdf = [System.IO.Path]::GetFullPath($PdfPath)

if (Test-Path $fullPdf) {
    Remove-Item -Force $fullPdf
}

Write-Host "[PS-Word] Inicializando instancia COM de Microsoft Word..."
$word = $null
$doc = $null
$conversionSuccess = $false
$conversionError = $null

try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0

    Write-Host "[PS-Word] Abriendo documento: $fullDocx"
    # En PowerShell 5.1 el primer parámetro de Open requiere [ref]
    $doc = $word.Documents.Open([ref]$fullDocx)
    
    Write-Host "[PS-Word] Exportando documento mediante ExportAsFixedFormat (wdExportFormatPDF = 17)..."
    $doc.ExportAsFixedFormat($fullPdf, 17)
    
    if (Test-Path $fullPdf) {
        $conversionSuccess = $true
        Write-Host "[PS-Word] Conversión finalizada con éxito: $fullPdf"
    } else {
        throw "El archivo PDF no fue generado tras ExportAsFixedFormat."
    }
}
catch {
    $conversionError = $_
    Write-Error "Error en Word COM durante la exportación a PDF: $_"
}
finally {
    if ($doc -ne $null) {
        try {
            # wdDoNotSaveChanges = 0
            $doc.Close([ref]0)
        } catch {}
        [System.Runtime.Interopservices.Marshal]::ReleaseComObject($doc) | Out-Null
    }
    if ($word -ne $null) {
        try {
            $word.Quit([ref]0)
        } catch {}
        [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null
    }
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}

if (-not $conversionSuccess) {
    exit 2
}
