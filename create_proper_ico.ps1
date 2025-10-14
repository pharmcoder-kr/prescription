# 올바른 ICO 파일 생성 스크립트
Add-Type -AssemblyName System.Drawing

try {
    # PNG 파일 로드
    $pngPath = "assets\icon.png"
    $icoPath = "assets\icon.ico"
    
    Write-Host "PNG 파일 로드 중: $pngPath"
    $png = [System.Drawing.Image]::FromFile($pngPath)
    
    # 여러 크기의 ICO 생성
    $sizes = @(16, 32, 48, 64, 128, 256)
    $bitmaps = @()
    
    foreach ($size in $sizes) {
        $bitmap = New-Object System.Drawing.Bitmap($png, $size, $size)
        $bitmaps += $bitmap
        Write-Host "크기 $size 생성 완료"
    }
    
    # ICO 파일 생성 (여러 크기 포함)
    $ico = [System.Drawing.Icon]::FromHandle($bitmaps[5].GetHicon())  # 256x256 사용
    
    # ICO 파일 저장
    $stream = [System.IO.File]::Create($icoPath)
    $ico.Save($stream)
    $stream.Close()
    
    # 리소스 정리
    $png.Dispose()
    foreach ($bitmap in $bitmaps) {
        $bitmap.Dispose()
    }
    $ico.Dispose()
    
    Write-Host "ICO 파일이 성공적으로 생성되었습니다: $icoPath"
    
    # 파일 크기 확인
    $fileInfo = Get-Item $icoPath
    Write-Host "생성된 ICO 파일 크기: $($fileInfo.Length) bytes"
    
} catch {
    Write-Host "오류 발생: $($_.Exception.Message)"
}









