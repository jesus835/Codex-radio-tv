Option Explicit

Dim fso, shell, appDir, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

appDir = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "cmd /c cd /d """ & appDir & """ && npm start"

' 0 = oculto, False = no esperar
shell.Run cmd, 0, False
