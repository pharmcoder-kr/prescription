# PNG to ICO 변환 스크립트
Add-Type -AssemblyName System.Drawing

try {
    # PNG 파일 로드
    $png = [System.Drawing.Image]::FromFile("assets\icon.png")
    
    # ICO 파일로 변환
    $ico = [System.Drawing.Icon]::FromHandle($png.GetHicon())
    
    # ICO 파일 저장
    $stream = [System.IO.File]::Create("assets\icon.ico")
    $ico.Save($stream)
    $stream.Close()
    
    # 리소스 정리
    $png.Dispose()
    $ico.Dispose()
    
    Write-Host "ICO 파일이 성공적으로 생성되었습니다!"
}
catch {
    Write-Host "오류 발생: $($_.Exception.Message)"
}









