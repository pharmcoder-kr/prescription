; NSIS 스크립트 - 바로가기 아이콘 설정
; electron-builder가 생성한 바로가기의 아이콘을 명시적으로 설정합니다.

!macro customShortcutIcon
  ; 설치 후 바로가기 아이콘 업데이트
  ; electron-builder가 이미 바로가기를 생성한 후 실행됩니다.
  
  ; 바탕화면 바로가기 아이콘 업데이트
  IfFileExists "$DESKTOP\오토시럽.lnk" 0 +2
    CreateShortcut "$DESKTOP\오토시럽.lnk" "$INSTDIR\오토시럽.exe" "" "$INSTDIR\오토시럽.exe" 0
  
  ; 시작 메뉴 바로가기 아이콘 업데이트
  IfFileExists "$SMPROGRAMS\오토시럽.lnk" 0 +2
    CreateShortcut "$SMPROGRAMS\오토시럽.lnk" "$INSTDIR\오토시럽.exe" "" "$INSTDIR\오토시럽.exe" 0
!macroend

!macro customFinish
  !insertmacro customShortcutIcon
!macroend
