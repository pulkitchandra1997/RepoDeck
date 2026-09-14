; A custom destination does not isolate Windows product state. Test in a VM.
Var RepoDeckGit
Var RepoDeckGitVersion

Function RepoDeckProbeGit
  StrCpy $RepoDeckGitVersion ""
  IfFileExists "$RepoDeckGit" 0 probe_done
  nsExec::ExecToStack /TIMEOUT=5000 '"$RepoDeckGit" --no-lazy-fetch --version'
  Pop $R0
  Pop $R1
  StrCmp $R0 "0" 0 probe_done
  StrCpy $R2 $R1 12
  StrCmp $R2 "git version " 0 probe_done
  StrCpy $RepoDeckGitVersion $R1
  probe_done:
FunctionEnd

Function RepoDeckFindGit
  SearchPath $RepoDeckGit "git.exe"
  Call RepoDeckProbeGit
  StrCmp $RepoDeckGitVersion "" 0 find_done
  StrCpy $RepoDeckGit "$PROGRAMFILES64\Git\cmd\git.exe"
  Call RepoDeckProbeGit
  StrCmp $RepoDeckGitVersion "" 0 find_done
  StrCpy $RepoDeckGit "$PROGRAMFILES32\Git\cmd\git.exe"
  Call RepoDeckProbeGit
  StrCmp $RepoDeckGitVersion "" 0 find_done
  StrCpy $RepoDeckGit "$LOCALAPPDATA\Programs\Git\cmd\git.exe"
  Call RepoDeckProbeGit
  find_done:
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  Call RepoDeckFindGit
  ${If} $RepoDeckGitVersion == ""
    IfSilent repodeck_git_abort 0
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "RepoDeck requires Git. Setup can download and launch Git for Windows using Windows Package Manager. Internet access is required. By continuing you accept the winget community source terms; Git's setup window will ask for its installation choices. Existing Git repositories and credentials will not be changed by RepoDeck." IDCANCEL repodeck_git_abort
    IfFileExists "$LOCALAPPDATA\Microsoft\WindowsApps\winget.exe" 0 repodeck_git_manual
    DetailPrint "Installing Git for Windows. Complete the Git setup window to continue."
    ExecWait '"$LOCALAPPDATA\Microsoft\WindowsApps\winget.exe" install --id Git.Git --exact --source winget --interactive --accept-source-agreements --disable-interactivity' $R0
    Call RepoDeckFindGit
    StrCmp $RepoDeckGitVersion "" 0 repodeck_git_done
    MessageBox MB_OK|MB_ICONEXCLAMATION "Git setup did not produce a usable Git installation (exit $R0). RepoDeck setup will not continue until Git is available."
    repodeck_git_manual:
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Install Git from its official download page, then return here and choose Retry. Git must be available on PATH or installed in its standard Windows location. Open the download page?" IDCANCEL repodeck_git_abort
    ExecShell "open" "https://git-scm.com/install/windows"
    repodeck_git_retry:
    MessageBox MB_RETRYCANCEL|MB_ICONINFORMATION "After Git installation finishes, choose Retry to verify it." IDCANCEL repodeck_git_abort
    Call RepoDeckFindGit
    StrCmp $RepoDeckGitVersion "" repodeck_git_retry repodeck_git_done
    repodeck_git_abort:
    DetailPrint "Git prerequisite not satisfied. Install Git and rerun RepoDeck setup."
    SetErrorLevel 2
    Abort "Git prerequisite not satisfied."
  ${EndIf}
  repodeck_git_done:
  DetailPrint "Git verified: $RepoDeckGitVersion"
!macroend
