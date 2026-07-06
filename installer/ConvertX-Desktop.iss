; ConvertX Desktop — per-user Windows installer.
; Compiled by scripts/build-installer.ts, which passes the defines:
;   ISCC /DAppVersion=1.0.0 /DBundleDir=<packaged bundle dir> installer\ConvertX-Desktop.iss

#ifndef AppVersion
  #error Pass /DAppVersion=x.y.z - use scripts/build-installer.ts
#endif
#ifndef BundleDir
  #error Pass /DBundleDir=<packaged bundle dir> - use scripts/build-installer.ts
#endif

[Setup]
; AppId must stay identical across releases so updates reuse the same
; uninstall entry (HKCU\...\Uninstall\<AppId>_is1).
AppId={{B7A9E2C4-6D31-4F5E-9A8B-2C4D7E1F0A63}
AppName=ConvertX Desktop
AppVersion={#AppVersion}
AppPublisher=Vojtech Stehlik
AppPublisherURL=https://github.com/sth3no/convertx-desktop
AppSupportURL=https://github.com/sth3no/convertx-desktop/issues
; Per-user: no UAC prompt; {autopf} resolves to %LOCALAPPDATA%\Programs.
PrivilegesRequired=lowest
DefaultDirName={autopf}\ConvertX Desktop
DisableProgramGroupPage=yes
; The app is a Bun runtime that ignores CTRL_C_EVENT, so Restart Manager's
; graceful close never succeeds - force-terminate on update installs.
CloseApplications=force
Compression=lzma2/max
SolidCompression=yes
OutputDir={#SourcePath}..\dist
OutputBaseFilename=ConvertX-Desktop-{#AppVersion}-Setup
SetupIconFile={#SourcePath}..\assets\icon.ico
UninstallDisplayIcon={app}\bin\launcher.exe
UninstallDisplayName=ConvertX Desktop
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Belt-and-suspenders exclude: bundle-vendor.ts already scrubs bin\app.log.
Source: "{#BundleDir}\*"; DestDir: "{app}"; Excludes: "bin\app.log"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\ConvertX Desktop"; Filename: "{app}\bin\launcher.exe"
Name: "{autodesktop}\ConvertX Desktop"; Filename: "{app}\bin\launcher.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\bin\launcher.exe"; Description: "{cm:LaunchProgram,ConvertX Desktop}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Runtime debris the launcher writes next to itself — app-owned, not user
; data. Without this the uninstaller leaves bin\app.log (and thus {app})
; behind. User data in %APPDATA%\ConvertX-Electrobun is deliberately NOT
; touched (user decision, Phase 2 spec).
Type: files; Name: "{app}\bin\app.log"
