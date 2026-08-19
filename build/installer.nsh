; NSIS 스크립트 - 바로가기 아이콘 강제 설정 (아이콘 경로 수정)

!macro customInstall
  ; 대상 EXE 찾기
  StrCpy $R1 "$INSTDIR\오토시럽.exe"
  IfFileExists $R1 0 +2
  Goto FoundExe
  StrCpy $R1 "$INSTDIR\auto-syrup.exe"
  FoundExe:
  
  ; 아이콘 파일 경로들 (여러 위치 시도)
  StrCpy $R0 "$INSTDIR\resources\icon.ico"  ; extraResources 경로
  StrCpy $R2 "$INSTDIR\resources\assets\icon.ico"  ; assets 경로
  StrCpy $R3 "$INSTDIR\icon.ico"  ; 루트 경로

  ; 기존 바로가기 삭제 (덮어쓰기/캐시 방지)
  Delete "$DESKTOP\오토시럽.lnk"
  Delete "$SMPROGRAMS\오토시럽\오토시럽.lnk"
  RMDir /r "$SMPROGRAMS\오토시럽"

  ; 시작메뉴 폴더 준비
  CreateDirectory "$SMPROGRAMS\오토시럽"

  ; 아이콘 파일 찾기 (우선순위: resources/icon.ico > resources/assets/icon.ico > icon.ico > EXE 아이콘)
  StrCpy $R4 $R1  ; 기본값: EXE 아이콘
  
  IfFileExists $R0 UseIcon0
  IfFileExists $R2 UseIcon2
  IfFileExists $R3 UseIcon3
  Goto CreateShortcuts
  
  UseIcon0:
    StrCpy $R4 $R0
    Goto CreateShortcuts
  UseIcon2:
    StrCpy $R4 $R2
    Goto CreateShortcuts
  UseIcon3:
    StrCpy $R4 $R3

  CreateShortcuts:
    ; 바로가기 생성 (아이콘 경로 명시)
    ; CreateShortCut shortcut_file target_file [parameters] [icon_file] [icon_index] [show_mode] [hotkey] [description]
    CreateShortCut "$DESKTOP\오토시럽.lnk" $R1 "" $R4 0 SW_SHOWNORMAL "" "오토시럽"
    CreateShortCut "$SMPROGRAMS\오토시럽\오토시럽.lnk" $R1 "" $R4 0 SW_SHOWNORMAL "" "오토시럽"
    
    ; 아이콘 캐시 갱신 (Windows가 새 아이콘을 인식하도록)
    System::Call 'shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend


!macro customUnInstall
  Delete "$DESKTOP\오토시럽.lnk"
  Delete "$SMPROGRAMS\오토시럽\오토시럽.lnk"
  RMDir  "$SMPROGRAMS\오토시럽"
!macroend
